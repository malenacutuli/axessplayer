// The ADAPTATION API handlers as PURE functions over an injected store + adapter registry + analyze
// backend + session verifier, so the node:http bridge is a thin shell and the contract is unit-testable.
// Routes (PORT 8105):
//   POST /analyze        -> { scores, scenes, plan }  (read-only; no pixel is touched)
//   POST /jobs           -> enqueue a tiered action; runs the DAG to its first park / terminal
//   GET  /jobs/:id       -> the job with its stage + state
//   POST /jobs/:id/approve -> the human review gate; resumes a Tier B/C job
// Auth mirrors services/ingestion/jobApi.ts: identity from the session bearer token, not the body. The
// shipped verifier is the TEST stub; production injects a real JWKS-backed one (cutover gate in the http
// bridge). No em dashes.

import { isCapability, tierOf, type Capability } from "./tiers.js";
import { scoreConfidence } from "./confidence.js";
import { estimateCost } from "./cost.js";
import { analyze, type AnalyzeBackend } from "./analyze.js";
import { evaluateForCapability, purgeOnRevocation, refreshConsent, type ConsentLedger } from "./rightsGate.js";
import { DAG_NODES, drive, buildProvenance, type JobRecord } from "./dag.js";
import type { AdaptationStore } from "./store.js";
import type { AdapterRegistry } from "./adapters.js";

// ---- auth (shape copied from services/ingestion/jobApi.ts; the live services are not imported) ----
export interface SessionIdentity {
  userId: string;
}
export interface SessionVerifier {
  verifySession(bearerToken: string | null): Promise<SessionIdentity | null>;
}
export function parseBearer(authorization: string | null | undefined): string | null {
  if (typeof authorization !== "string") return null;
  const m = /^Bearer (.+)$/.exec(authorization.trim());
  if (m == null) return null;
  const token = m[1].trim();
  return token.length > 0 ? token : null;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function testSessionVerifier(): SessionVerifier {
  return {
    async verifySession(bearerToken) {
      if (bearerToken == null) return null;
      const m = /^session:(.+)$/.exec(bearerToken);
      if (m == null) return null;
      const userId = m[1];
      if (!UUID_RE.test(userId)) return null;
      return { userId };
    },
  };
}

export interface ApiRequest {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}
export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface ApiDeps {
  store: AdaptationStore;
  registry: AdapterRegistry;
  backend: AnalyzeBackend;
  verifier: SessionVerifier;
  consent: ConsentLedger;
}

function source(store: AdaptationStore): "wired" | "unwired" {
  return store.wired ? "wired" : "unwired";
}
function json(status: number, body: unknown): ApiResponse {
  return { status, body };
}
async function requireSession(req: ApiRequest, verifier: SessionVerifier): Promise<ApiResponse | null> {
  const id = await verifier.verifySession(parseBearer(req.authorization));
  if (id == null) return json(401, { error: "unauthenticated" });
  return null;
}

let seq = 0;
function newId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

export async function handle(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const { store, verifier } = deps;

  if (req.path === "/health") {
    return json(200, { ok: true, service: "adaptation", source: source(store) });
  }

  if (req.path === "/analyze") {
    if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
    const unauth = await requireSession(req, verifier);
    if (unauth) return unauth;
    return analyzeRoute(req, deps);
  }

  if (req.path === "/jobs") {
    if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
    const unauth = await requireSession(req, verifier);
    if (unauth) return unauth;
    return enqueueRoute(req, deps);
  }

  if (req.path.startsWith("/jobs/")) {
    const rest = req.path.slice("/jobs/".length);
    if (rest.endsWith("/approve")) {
      if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
      const unauth = await requireSession(req, verifier);
      if (unauth) return unauth;
      const jobId = decodeURIComponent(rest.slice(0, -"/approve".length));
      return approveRoute(jobId, req, deps);
    }
    if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
    const unauth = await requireSession(req, verifier);
    if (unauth) return unauth;
    const jobId = decodeURIComponent(rest);
    if (jobId.length === 0) return json(400, { error: "invalid_job_id" });
    const job = await store.getJob(jobId);
    if (job == null) return json(404, { error: "job_not_found", source: source(store) });
    return json(200, { job: publicJob(job), source: source(store) });
  }

  return json(404, { error: "not_found" });
}

// POST /analyze: register (or read) the source, run the read-only analysis, return scores + scene
// timeline + plan. A source must be registered with its rights + duration in the body so the plan can be
// cost-scored and a later enqueue can find it. No pixel is touched here.
async function analyzeRoute(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const assetUrl = b.assetUrl;
  if (typeof assetUrl !== "string" || assetUrl.length === 0) return json(400, { error: "invalid_asset_url" });
  const budgetUsd = typeof b.budgetUsd === "number" ? b.budgetUsd : null;

  const result = await analyze(assetUrl, deps.backend, budgetUsd);

  // Register the source so a follow-up POST /jobs can resolve it. Rights default to closed (RED) unless
  // the caller supplied a checklist; durationMs comes from the probe.
  const sourceId = typeof b.sourceId === "string" && b.sourceId.length > 0 ? b.sourceId : newId("src");
  const isHero = b.isHero === true;
  const rights = readRights(b.rights);
  await deps.store.putSource({ sourceId, assetUrl, isHero, durationMs: result.probe.durationMs, rights });

  // scores: per-capability band + reliability tier, the operator-facing "what is one-click vs reviewed".
  const scores = result.proposed.map((p) => ({
    capability: p.capability,
    tier: p.tier,
    confidence: p.confidence,
    confidenceScore: p.confidenceScore,
    mode: p.mode,
    lowConfidenceFlagged: p.lowConfidenceFlagged,
    estimatedUsd: p.estimatedUsd,
  }));
  return json(200, {
    sourceId,
    scores,
    scenes: result.scenes,
    plan: result.proposed,
    source: source(deps.store),
  });
}

// POST /jobs: enqueue a tiered action. Classifies the tier, scores confidence, evaluates the HARD rights
// gate (refreshing consent from the ledger), seeds the DAG, and drives it to its first park / terminal.
// A rights-missing source is BLOCKED here; a Tier C action parks at human_review (never auto-renders).
async function enqueueRoute(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const sourceId = b.sourceId;
  if (typeof sourceId !== "string" || sourceId.length === 0) return json(400, { error: "invalid_source_id" });
  const capRaw = b.capability;
  if (!isCapability(capRaw)) return json(400, { error: "invalid_capability" });
  const capability: Capability = capRaw;

  const src = await deps.store.getSource(sourceId);
  if (src == null) return json(404, { error: "source_not_found", source: source(deps.store) });

  const tier = tierOf(capability);
  const budgetUsd = typeof b.budgetUsd === "number" ? b.budgetUsd : null;
  const prompt = typeof b.prompt === "string" ? b.prompt : null;

  // Refresh consent from the ledger (a revocation since the gate was filled is caught here).
  const rights = await refreshConsent(src.rights, deps.consent);

  // Confidence from the same signals the plan used (re-derived conservatively from the probe).
  const conf = scoreConfidence(capability, {
    sourceQuality: src.durationMs > 0 ? 0.9 : 0.5,
    preconditionCoverage: 0.8,
    adapterReliability: 0.8,
  });

  // Low-confidence / Tier C actions require an operator prompt up front.
  if (conf.mode === "require_prompt" && (prompt == null || prompt.length === 0)) {
    return json(400, { error: "prompt_required_for_low_confidence_action", tier, confidence: conf.band });
  }

  const cost = estimateCost(capability, src.durationMs, budgetUsd);

  let job: JobRecord = {
    jobId: newId("job"),
    sourceId,
    capability,
    tier,
    confidence: conf.band,
    confidenceScore: conf.score,
    lowConfidenceFlagged: conf.lowConfidenceFlagged,
    state: "running",
    currentStage: DAG_NODES[1], // start at rights_gate: source_ingest is already done by /analyze
    estimatedUsd: cost.estimatedUsd,
    budgetUsd,
    prompt,
    isHero: src.isHero,
    sourceDurationMs: src.durationMs,
    rights,
    humanReviewApproved: false,
    variantId: null,
    playbackUrl: null,
  };

  // Drive the DAG to its first park (blocked / awaiting_review / paused_over_budget) or terminal.
  job = await drive(job, deps.registry);
  await deps.store.putJob(job);

  const status = job.state === "blocked" ? 422 : job.state === "failed" ? 422 : 201;
  return json(status, { job: publicJob(job), source: source(deps.store) });
}

// POST /jobs/:id/approve: the human review gate. Records the reviewer, sets humanReviewApproved, and
// RESUMES the DAG. A Tier A job needs no approval (returns 409). Re-evaluates the rights gate on resume,
// so a consent revoked between enqueue and approval still blocks. A revocation purges variants.
async function approveRoute(jobId: string, req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  if (jobId.length === 0) return json(400, { error: "invalid_job_id" });
  const existing = await deps.store.getJob(jobId);
  if (existing == null) return json(404, { error: "job_not_found", source: source(deps.store) });
  if (existing.tier === "A") return json(409, { error: "tier_A_needs_no_review" });
  if (existing.state !== "awaiting_review") {
    return json(409, { error: "job_not_awaiting_review", state: existing.state });
  }

  const b = (req.body ?? {}) as Record<string, unknown>;
  const reviewer = typeof b.reviewer === "string" && b.reviewer.length > 0 ? b.reviewer : null;
  if (reviewer == null) return json(400, { error: "reviewer_required" });

  // Re-check consent at approval time. A revocation here both blocks AND purges any prior variant.
  const rights = await refreshConsent(existing.rights, deps.consent);
  const ev = evaluateForCapability(rights, existing.capability);
  if (ev.blocked) {
    const purged =
      existing.variantId != null
        ? await deps.store.purgeForSource(
            existing.sourceId,
            purgeOnRevocation([{ variantId: existing.variantId, transformation: existing.capability }]),
          )
        : [];
    const blockedJob: JobRecord = { ...existing, rights, state: "blocked", currentStage: "rights_gate", variantId: null };
    await deps.store.putJob(blockedJob);
    return json(422, { job: publicJob(blockedJob), purged, reason: ev.reasons, source: source(deps.store) });
  }

  await deps.store.approveJob(jobId, reviewer);
  let job: JobRecord = { ...existing, rights, humanReviewApproved: true, state: "running" };
  job = await drive(job, deps.registry);

  // Stamp the reviewer onto the registered variant's provenance when the render produced one.
  const provenance = job.variantId != null ? buildProvenance(job, `gated.${job.capability}`, reviewer) : null;
  await deps.store.putJob(job);
  return json(200, { job: publicJob(job), provenance, source: source(deps.store) });
}

// ---- helpers ----

function readRights(raw: unknown): JobRecord["rights"] {
  const r = (raw ?? {}) as Record<string, unknown>;
  const bool = (k: string): boolean => r[k] === true;
  const consentRef = typeof r.consentRef === "string" ? r.consentRef : null;
  return {
    ownsFootage: bool("ownsFootage"),
    actorAdaptationRights: bool("actorAdaptationRights"),
    voiceRights: bool("voiceRights"),
    likenessRights: bool("likenessRights"),
    musicRights: bool("musicRights"),
    territoryCleared: bool("territoryCleared"),
    brandLogoCleared: bool("brandLogoCleared"),
    aiTransformationAllowed: bool("aiTransformationAllowed"),
    ageSensitiveReviewed: bool("ageSensitiveReviewed"),
    consentRef,
    consentCurrent: bool("consentCurrent"),
  };
}

// The public projection of a job: the gate inputs (rights) are NOT leaked; only the decision-relevant
// fields are returned to the operator UI.
function publicJob(job: JobRecord): Record<string, unknown> {
  return {
    jobId: job.jobId,
    sourceId: job.sourceId,
    capability: job.capability,
    tier: job.tier,
    confidence: job.confidence,
    confidenceScore: Math.round(job.confidenceScore * 1000) / 1000,
    lowConfidenceFlagged: job.lowConfidenceFlagged,
    state: job.state,
    currentStage: job.currentStage,
    estimatedUsd: job.estimatedUsd,
    isHero: job.isHero,
    variantId: job.variantId,
    playbackUrl: job.playbackUrl,
  };
}
