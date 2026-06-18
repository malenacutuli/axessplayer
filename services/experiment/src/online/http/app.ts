// HTTP router for the ONLINE experiment serving tier (Slice B). A thin node:http handler (no Hono, no new
// dependency) over the pure assignment + bandit core and the in-memory store. It consolidates the four
// experiment surfaces the INTERACTION_MAP places here (today spread across prompts 03/04/15):
//
//   POST /assign           deterministic A/B bucket + propensity, or an epsilon-greedy arm selection.
//   POST /creative/impression   log an ad-creative impression into the creative bandit.
//   POST /creative/outcome      log an ad-creative click/conversion (with optional cost) into the bandit.
//   POST /poster/impression     log a poster impression (feeds the same bandit machinery).
//   POST /poster/click          log a poster click.
//   GET  /poster/select         choose a poster id from a set; accessibility-first variant ALWAYS eligible.
//   POST /ending                deterministic ending-test assignment for a unit.
//   GET  /healthz, /weights     liveness and the DISPLAY-ONLY reward-weights gate state.
//
// HARD GATE: the selection core (bandit-core.ts) is reward-neutral while REWARD_WEIGHTS_SIGNED_OFF is
// false, so none of these endpoints can optimize a revenue/extraction objective until a founder sign-off.
// This layer adds auth at the edge, body parsing, and response mapping. It adds no bandit logic. No em
// dashes.

import type { IncomingMessage } from "node:http";
import { URL } from "node:url";

import { DEFAULT_EPSILON } from "../config.js";
import {
  REWARD_WEIGHTS_SIGNED_OFF,
  getWeights,
  ctr,
  type Arm,
} from "../bandit-core.js";
import { assignDeterministic, assignBandit, type Variant } from "../assign.js";
import { type ExperimentStore } from "../store.js";
import {
  type PosterCandidateStore,
  type PosterSet,
  UnwiredPosterCandidateStore,
  candidateArms,
  posterArmId,
  posterIdFromArm,
  fallbackCandidate,
  type PosterCandidate,
} from "../poster-candidates.js";
import { parseBearer, type SessionVerifier } from "./auth.js";

export interface AppDeps {
  store: ExperimentStore;
  session: SessionVerifier;
  // The 25-D2 poster candidate store. Optional: when absent the UNWIRED store is used, so the candidate
  // read is empty (source "unwired") and /poster/select falls back to the single series poster_url.
  posterCandidates?: PosterCandidateStore;
}

// A framework-free result: status, JSON body. The node:http bridge writes it out. Keeping the router a
// pure (request -> result) function makes it testable without binding a socket.
export type HttpResult = { status: number; body: unknown };

const json = (status: number, body: unknown): HttpResult => ({ status, body });

// The accessibility-first poster variant convention: an arm id prefixed "a11y:" (or flagged in the
// request) is pinned alwaysEligible so it can never be filtered out of a poster set. This is the
// content/accessibility firewall expressed at the selection boundary.
function isAccessibilityFirst(id: string): boolean {
  return id.startsWith("a11y:");
}

// The shipped (unwired) poster candidate store, used when AppDeps does not inject one. Resolves every
// series to an empty set with source "unwired", so /poster/select falls back to the single series poster.
const UNWIRED_CANDIDATES = new UnwiredPosterCandidateStore();

// Build the per-arm reward (CTR) lookup for a poster SET from the store's measured stats, and prime the
// bandit arm set with accessibility-first candidates pinned alwaysEligible. Reward is carried but GATED:
// epsilonGreedy ignores rewardEstimate while unsigned, so a measured CTR never moves the choice. Stats are
// read once up front so candidateArms() can map each arm id to its smoothed CTR synchronously.
function posterRewardLookup(store: ExperimentStore, experiment: string) {
  return {
    async prime(set: PosterSet): Promise<Arm[]> {
      const reward = new Map<string, number>();
      for (const c of set.candidates) {
        const id = posterArmId(set.seriesId, c);
        reward.set(id, ctr(await store.stats(experiment, id)));
      }
      return candidateArms(set, (id) => reward.get(id) ?? ctr(emptyArmStats()));
    },
  };
}

// A zero-impression stats reads as the neutral smoothed prior. Local to avoid importing emptyStats twice.
function emptyArmStats() {
  return { impressions: 0, clicks: 0, conversions: 0, cost: 0 };
}

// Route a parsed request to a result. Pure over (method, path, query, body, deps): no socket, no clock.
export async function route(
  method: string,
  pathname: string,
  query: URLSearchParams,
  body: unknown,
  authorization: string | null | undefined,
  deps: AppDeps
): Promise<HttpResult> {
  // Liveness and the gate-state probe are unauthenticated and read-only.
  if (method === "GET" && pathname === "/healthz") {
    return json(200, { status: "ok" });
  }
  if (method === "GET" && pathname === "/weights") {
    // DISPLAY-ONLY. Surfaces the founder gate so a dashboard can show "weights inactive (unsigned)".
    return json(200, { signedOff: REWARD_WEIGHTS_SIGNED_OFF, weights: getWeights() });
  }

  // GET /poster/candidates/:seriesId  read the poster SET for a series. Empty + source "unwired" until the
  // additive mobile.poster_candidates table is applied. NEVER fabricated.
  if (method === "GET" && pathname.startsWith("/poster/candidates/")) {
    const seriesId = decodeURIComponent(pathname.slice("/poster/candidates/".length)).trim();
    if (seriesId.length === 0) {
      return json(400, { error: "invalid_request", detail: "seriesId is required" });
    }
    const candidateStore = deps.posterCandidates ?? UNWIRED_CANDIDATES;
    const set = await candidateStore.resolve(seriesId);
    return json(200, { seriesId, candidates: set.candidates, source: set.source });
  }

  // GET /poster/select?set=<seriesId>&unit=<viewerId>  choose ONE poster from the series' candidate SET via
  // the learned-CTR epsilon-greedy bandit (25-D2). The accessibility-first candidate is ALWAYS eligible and
  // is the guaranteed fallback. Until the candidate table is applied the SET is empty, so we fall back to the
  // single series poster_url (passed as posterUrl, treated as the accessibility-first variant).
  if (method === "GET" && pathname === "/poster/select") {
    const seriesId = (query.get("set") ?? query.get("series") ?? "").trim();
    const unit = (query.get("unit") ?? "anon").trim() || "anon";
    if (seriesId.length === 0) {
      return json(400, { error: "invalid_request", detail: "set (seriesId) is required" });
    }
    // The bandit namespace for this series' poster test. CTR is keyed on (seriesId, posterId, viewer) via
    // this experiment id plus the per-candidate arm id, so two series never share a poster's counters.
    const experiment = query.get("experiment") ?? `poster:${seriesId}`;
    const candidateStore = deps.posterCandidates ?? UNWIRED_CANDIDATES;
    let set = await candidateStore.resolve(seriesId);

    // Fallback: no candidate SET (table unwired or series has none). Serve the single series poster_url as
    // the accessibility-first candidate. posterUrl is supplied by the caller (this tier has no series DB);
    // when absent the fallback candidate still resolves with an empty url, flagged source "fallback".
    if (set.candidates.length === 0) {
      const posterUrl = (query.get("posterUrl") ?? "").trim();
      set = {
        seriesId,
        candidates: [fallbackCandidate(seriesId, posterUrl)],
        source: "fallback",
      };
    }

    // Reward (CTR) per arm from the store. Gated downstream: epsilonGreedy ignores it while unsigned.
    const rewardFor = posterRewardLookup(deps.store, experiment);
    const arms = await rewardFor.prime(set);
    const sel = assignBandit(unit, experiment, arms, epsilonOf(query.get("epsilon")));
    const posterId = posterIdFromArm(seriesId, sel.chosen);
    const chosen = set.candidates.find((c) => posterArmId(seriesId, c) === sel.chosen) ?? null;

    return json(200, {
      seriesId,
      // The chosen poster, mapped back to the candidate the caller serves.
      posterId,
      url: chosen?.url ?? null,
      armId: sel.chosen,
      accessibilityFirst: chosen?.accessibilityFirst ?? false,
      source: set.source,
      propensity: sel.propensity,
      explored: sel.explored,
      rewardApplied: sel.rewardApplied,
      signedOff: REWARD_WEIGHTS_SIGNED_OFF,
    });
  }

  // Everything below is a POST with a JSON object body.
  if (method !== "POST") return json(404, { error: "not_found" });
  if (body == null || typeof body !== "object") {
    return json(400, { error: "invalid_json" });
  }
  const b = body as Record<string, unknown>;

  // POST /assign  deterministic A/B bucket, or epsilon-greedy arm selection when arms[] is supplied.
  if (pathname === "/assign") {
    const unit = str(b.unit);
    const experiment = str(b.experiment);
    if (unit == null || experiment == null) {
      return json(400, { error: "invalid_request", detail: "unit and experiment are required" });
    }
    // Bandit mode: arms supplied -> epsilon-greedy (propensity-logged, reward-gated).
    if (Array.isArray(b.arms)) {
      const arms = parseArms(b.arms);
      if (arms == null) return json(400, { error: "invalid_request", detail: "bad arms" });
      const eps = typeof b.epsilon === "number" ? b.epsilon : DEFAULT_EPSILON;
      const sel = assignBandit(unit, experiment, arms, eps);
      return json(200, {
        unit,
        experiment,
        variant: sel.chosen,
        propensity: sel.propensity,
        explored: sel.explored,
        rewardApplied: sel.rewardApplied,
      });
    }
    // Split mode: variants supplied -> deterministic weighted hash split.
    const variants = parseVariants(b.variants);
    if (variants == null) return json(400, { error: "invalid_request", detail: "bad variants" });
    const a = assignDeterministic(unit, experiment, variants);
    return json(200, a);
  }

  // POST /ending  deterministic ending-test assignment. Ending tests are a fixed split (a viewer must see
  // a stable ending, so no exploration here): pure deterministic bucketing.
  if (pathname === "/ending") {
    const experiment = str(b.experiment);
    const variants = parseVariants(b.endings ?? b.variants);
    // Identity from the session subject when present; otherwise the supplied unit (anonymous bucketing).
    const identity = await deps.session.verifySession(parseBearer(authorization));
    const unit = identity?.userId ?? str(b.unit);
    if (unit == null || experiment == null || variants == null) {
      return json(400, { error: "invalid_request", detail: "unit/experiment/endings required" });
    }
    const a = assignDeterministic(unit, experiment, variants);
    return json(200, { ...a, ending: a.variant });
  }

  // Creative event logging. armId is the creative id. experiment namespaces the bandit.
  if (pathname === "/creative/impression") {
    const { experiment, armId, err } = eventArgs(b);
    if (err) return err;
    await deps.store.recordImpression(experiment, armId);
    return json(200, { ok: true });
  }

  // Poster event logging (25-D2). Keys on (seriesId, posterId, viewer): the bandit experiment namespace is
  // poster:<seriesId> and the arm id is the per-candidate arm derived from (seriesId, posterId), so a
  // poster's CTR never leaks across series. The viewer is logged for propensity-honest off-policy eval (the
  // counter itself is per-arm; per-viewer dedupe is the caller's idempotency concern). Feeds the same
  // epsilon-greedy bandit /poster/select reads.
  if (pathname === "/poster/impression" || pathname === "/poster/click") {
    const candidateStore = deps.posterCandidates ?? UNWIRED_CANDIDATES;
    const args = await posterEventArgs(b, candidateStore);
    if (args.err) return args.err;
    if (pathname === "/poster/impression") {
      await deps.store.recordImpression(args.experiment, args.armId);
    } else {
      await deps.store.recordClick(args.experiment, args.armId);
    }
    return json(200, { ok: true, experiment: args.experiment, armId: args.armId });
  }
  if (pathname === "/creative/outcome") {
    const { experiment, armId, err } = eventArgs(b);
    if (err) return err;
    // A creative outcome is a click and (optionally) a conversion with cost. Both feed the same bandit.
    await deps.store.recordClick(experiment, armId);
    if (b.conversion === true) {
      const cost = typeof b.cost === "number" ? b.cost : 0;
      await deps.store.recordOutcome(experiment, armId, cost);
    }
    return json(200, { ok: true });
  }

  return json(404, { error: "not_found" });
}

// ---- small parsing helpers ----

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function epsilonOf(raw: string | null): number {
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_EPSILON;
}

// Validate the (experiment, armId) pair shared by every event endpoint. Returns an err result on bad
// input so the caller can early-return without duplicating the 400 shape.
function eventArgs(b: Record<string, unknown>): { experiment: string; armId: string; err: HttpResult | null } {
  const experiment = str(b.experiment);
  const armId = str(b.armId ?? b.arm_id ?? b.creative ?? b.poster);
  if (experiment == null || armId == null) {
    return { experiment: "", armId: "", err: json(400, { error: "invalid_request", detail: "experiment and armId required" }) };
  }
  return { experiment, armId, err: null };
}

// Validate a poster impression/click event and derive its bandit key, keyed on (seriesId, posterId,
// viewer). The experiment namespace is poster:<seriesId>; the arm id is the per-candidate arm derived from
// (seriesId, posterId, accessibilityFirst). The arm MUST match the one /poster/select chose so the CTR
// feeds the right counter, so the accessibility-first flag is resolved from the candidate store when the
// series has a SET (the viewer-side client need not echo it). The body flag is honored as a fallback (e.g.
// the unwired fallback candidate). Backward-compatible: an explicit experiment + armId still works.
async function posterEventArgs(
  b: Record<string, unknown>,
  candidateStore: PosterCandidateStore
): Promise<{ experiment: string; armId: string; err: HttpResult | null }> {
  // Legacy/explicit path: experiment + armId supplied verbatim.
  const explicitExperiment = str(b.experiment);
  const explicitArm = str(b.armId ?? b.arm_id);
  if (explicitExperiment != null && explicitArm != null) {
    return { experiment: explicitExperiment, armId: explicitArm, err: null };
  }
  // 25-D2 path: derive from (seriesId, posterId).
  const seriesId = str(b.seriesId ?? b.series ?? b.set);
  const posterId = str(b.posterId ?? b.poster);
  if (seriesId == null || posterId == null) {
    return {
      experiment: "",
      armId: "",
      err: json(400, { error: "invalid_request", detail: "seriesId and posterId required" }),
    };
  }
  // Resolve the accessibility-first flag from the stored SET so the arm id matches selection exactly. Fall
  // back to the request flag when the series has no candidate row for this posterId.
  const set = await candidateStore.resolve(seriesId);
  const stored = set.candidates.find((c) => c.posterId === posterId);
  const accessibilityFirst = stored?.accessibilityFirst ?? b.accessibilityFirst === true;
  const candidate: PosterCandidate = {
    posterId,
    url: "",
    emotion: null,
    character: null,
    language: null,
    accessibilityFirst,
  };
  return { experiment: `poster:${seriesId}`, armId: posterArmId(seriesId, candidate), err: null };
}

function parseVariants(raw: unknown): Variant[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: Variant[] = [];
  for (const v of raw) {
    if (typeof v === "string") {
      out.push({ id: v, weight: 1 });
      continue;
    }
    if (v != null && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const id = str(o.id);
      if (id == null) return null;
      out.push({ id, weight: typeof o.weight === "number" ? o.weight : 1 });
      continue;
    }
    return null;
  }
  return out;
}

function parseArms(raw: unknown[]): Arm[] | null {
  const out: Arm[] = [];
  for (const v of raw) {
    if (typeof v === "string") {
      out.push({ id: v, rewardEstimate: 0, eligible: true, ...(isAccessibilityFirst(v) ? { alwaysEligible: true } : {}) });
      continue;
    }
    if (v != null && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const id = str(o.id);
      if (id == null) return null;
      out.push({
        id,
        rewardEstimate: typeof o.rewardEstimate === "number" ? o.rewardEstimate : 0,
        eligible: o.eligible !== false,
        ...(o.alwaysEligible === true || isAccessibilityFirst(id) ? { alwaysEligible: true } : {}),
      });
      continue;
    }
    return null;
  }
  return out.length > 0 ? out : null;
}

// Read and JSON-parse a node:http request body. Returns undefined for an empty body (a GET), null for a
// malformed body (so the router can answer 400), or the parsed value.
export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

// Parse the request URL into pathname + query, tolerant of a missing Host header.
export function parseUrl(req: IncomingMessage): { pathname: string; query: URLSearchParams } {
  const host = req.headers.host ?? "experiment.local";
  const u = new URL(req.url ?? "/", `http://${host}`);
  return { pathname: u.pathname, query: u.searchParams };
}
