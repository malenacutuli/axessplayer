// The JOB API CONTRACT handlers (services/ingestion, VITE_INGESTION_BASE_URL), as PURE functions over an
// injected JobsStore + session verifier, so the node:http bridge is a thin shell and the contract is unit-
// testable. Routes:
//   GET  /jobs       -> [{jobId, seriesId, episodeId, kind, stages:[{name,status,cost,assetId}], state, estimatedUsd}]
//   GET  /jobs/:id   -> the one job with per-stage detail
//   POST /produce    -> {jobId, plan, estimatedUsd}  (enqueue only; the executor runs async)
// Every list/job payload carries source:"unwired" until the additive produce_jobs table is applied (see
// jobsStore.ts), so the client never mistakes a preview for a committed, running production. No em dashes.
//
// Auth mirrors services/decision/src/http/auth.ts: identity comes from the session bearer token, not the
// body. The shipped default is the TEST verifier (session:<uuid>); production must inject a real one.

import type { JobsStore } from "./jobsStore.js";
import { parseTargets } from "./produceCost.js";

// ---- auth (copied shape from services/decision/src/http/auth.ts; the content service must not be imported)
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
// TEST verifier: "session:<uuid>" resolves to that uuid. No signature check. Flagged; real JWKS verification
// is the cutover gate. Anything else -> null -> 401.
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

// ---- a transport-agnostic request/response shape so the handlers are pure.
export interface ApiRequest {
  method: string;
  path: string; // pathname only, no query
  authorization: string | null;
  body: unknown; // parsed JSON or undefined
}
export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface ApiDeps {
  store: JobsStore;
  verifier: SessionVerifier;
}

function source(store: JobsStore): "wired" | "unwired" {
  return store.wired ? "wired" : "unwired";
}

function json(status: number, body: unknown): ApiResponse {
  return { status, body };
}

// Resolve the acting viewer or produce a 401. Returns null when authenticated (proceed), or an ApiResponse
// to short-circuit with.
async function requireSession(req: ApiRequest, verifier: SessionVerifier): Promise<ApiResponse | null> {
  const id = await verifier.verifySession(parseBearer(req.authorization));
  if (id == null) return json(401, { error: "unauthenticated" });
  return null;
}

// The single entry the bridge calls. Routes by method + path. Unknown route -> 404; bad method -> 405.
export async function handle(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const { store, verifier } = deps;

  if (req.path === "/health") {
    return json(200, { ok: true, service: "ingestion", source: source(store) });
  }

  if (req.path === "/jobs") {
    if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
    const unauth = await requireSession(req, verifier);
    if (unauth) return unauth;
    const jobs = await store.list();
    return json(200, { jobs, source: source(store) });
  }

  if (req.path.startsWith("/jobs/")) {
    if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
    const unauth = await requireSession(req, verifier);
    if (unauth) return unauth;
    const jobId = decodeURIComponent(req.path.slice("/jobs/".length));
    if (jobId.length === 0) return json(400, { error: "invalid_job_id" });
    const job = await store.get(jobId);
    if (job == null) return json(404, { error: "job_not_found", source: source(store) });
    return json(200, { job, source: source(store) });
  }

  if (req.path === "/produce") {
    if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
    const unauth = await requireSession(req, verifier);
    if (unauth) return unauth;
    return produce(req, store);
  }

  return json(404, { error: "not_found" });
}

// POST /produce: validate, compute the fan-out plan + estimatedUsd (the cost-before-commit preview), enqueue
// the job (a row when wired; an in-process preview when unwired) and return {jobId, plan, estimatedUsd}.
// Enqueue only: the executor advances stages async; this never reports a stage as done.
async function produce(req: ApiRequest, store: JobsStore): Promise<ApiResponse> {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const seriesId = b.seriesId;
  if (typeof seriesId !== "string" || seriesId.length === 0) return json(400, { error: "invalid_series_id" });
  const episodeId = typeof b.episodeId === "string" ? b.episodeId : null;
  const beats = typeof b.beats === "number" && b.beats > 0 ? Math.floor(b.beats) : 1;

  const parsed = parseTargets(b);
  if ("error" in parsed) return json(400, { error: parsed.error });

  const { job, plan } = await store.create({ seriesId, episodeId, targets: parsed.targets, beats });
  return json(200, {
    jobId: job.jobId,
    plan,
    estimatedUsd: plan.estimatedUsd,
    state: job.state,
    stages: job.stages,
    source: source(store),
  });
}
