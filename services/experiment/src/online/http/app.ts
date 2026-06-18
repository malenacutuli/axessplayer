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
  armFromStats,
  type Arm,
} from "../bandit-core.js";
import { assignDeterministic, assignBandit, type Variant } from "../assign.js";
import { type ExperimentStore } from "../store.js";
import { parseBearer, type SessionVerifier } from "./auth.js";

export interface AppDeps {
  store: ExperimentStore;
  session: SessionVerifier;
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

// Build the poster arm set from the requested ids plus the store's measured stats, pinning the
// accessibility-first variant alwaysEligible. Reward (CTR) is carried but gated downstream.
async function posterArms(
  store: ExperimentStore,
  experiment: string,
  ids: string[]
): Promise<Arm[]> {
  const arms: Arm[] = [];
  for (const id of ids) {
    const s = await store.stats(experiment, id);
    arms.push(
      armFromStats(id, s, {
        eligible: true,
        ...(isAccessibilityFirst(id) ? { alwaysEligible: true } : {}),
      })
    );
  }
  return arms;
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

  // GET /poster/select?set=a,b,c&experiment=...  choose a poster, accessibility-first always eligible.
  if (method === "GET" && pathname === "/poster/select") {
    const set = (query.get("set") ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    const experiment = query.get("experiment") ?? "poster-default";
    const unit = query.get("unit") ?? "anon";
    if (set.length === 0) return json(400, { error: "invalid_request", detail: "set is required" });
    const arms = await posterArms(deps.store, experiment, set);
    const sel = assignBandit(unit, experiment, arms, epsilonOf(query.get("epsilon")));
    return json(200, {
      poster: sel.chosen,
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

  // Creative + poster event logging. armId is the creative/poster id. experiment namespaces the bandit.
  if (pathname === "/creative/impression" || pathname === "/poster/impression") {
    const { experiment, armId, err } = eventArgs(b);
    if (err) return err;
    await deps.store.recordImpression(experiment, armId);
    return json(200, { ok: true });
  }
  if (pathname === "/poster/click") {
    const { experiment, armId, err } = eventArgs(b);
    if (err) return err;
    await deps.store.recordClick(experiment, armId);
    return json(200, { ok: true });
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
