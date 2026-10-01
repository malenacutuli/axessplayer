// The /decide handler. Wires the canon filter, the LinUCB bandit, the KV serving layer, and the
// async decision logger into one request path. Matches contracts/api/decision.yaml (0.3.1) EXACTLY:
// the request and response types below are DERIVED from the codegen operations type, so a contract
// change is a typecheck failure here. No em dashes.
//
// Failure-safe by design (design 4): on the serving timeout, on opt-out (users.adaptive_opt_in =
// false), or on ANY error, the handler returns the control director's cut. The arm set is canon-
// filtered BEFORE the bandit ranks (design 2), so a story-breaking variant can never be chosen.

import type { operations } from "../../../contracts/types/generated/decision.js";
import { assignControl, chooseBranch, directorsCutOf, type Branch } from "./policy.js";
import { canonFilter, type CanonCandidate, type CanonFacts } from "./canon.js";
import { chooseArm, type FeatureContribution } from "./bandit.js";
import { armModelOrPrior, type PolicyKV } from "./kv.js";
import { type DecisionLogger } from "./logger.js";
import {
  toArray,
  updateVector,
  type PreferenceVector,
  type BeatSignals,
  type CohortSeeds,
} from "./features.js";
import { EXPLORATION_ALPHA, PREFETCH_TOP_K, SERVE_TIMEOUT_MS, policyVersion } from "./config.js";
import { randomUUID } from "node:crypto";

// Request and response shapes, bound to the generated contract types. If decision.yaml changes and is
// re-generated, these aliases break and the handler stops typechecking until it is reconciled.
export type DecideRequest = operations["decide"]["requestBody"]["content"]["application/json"];
export type DecideResponse =
  operations["decide"]["responses"][200]["content"]["application/json"];

// The 422 the contract defines: end of graph, no successor variants. Carries the contract error string.
export class NoSuccessorsError extends Error {
  readonly status = 422 as const;
  readonly body: { error: string };
  constructor() {
    super("no_successors");
    this.name = "NoSuccessorsError";
    this.body = { error: "no_successors" };
  }
}

// Graph and per-viewer-state reads from the system of record (Postgres). NOTE: on the hot path the
// viewer vector and arm models come from KV, not from here; this interface supplies the canon-relevant
// content graph (which is small and cacheable) plus the cold-start system-of-record reads.
export interface DecisionDB {
  // Series of a beat (viewer_state PK is (user_id, series_id)).
  seriesOfBeat(beatId: string): Promise<string>;
  // Valid successor candidates resolved from beat_edges + beat_variants, each tagged with its branch,
  // whether its edge is valid, and the canon facts it asserts. The canon filter is the gate, not this.
  candidatesOf(beatId: string): Promise<CanonCandidate[]>;
  // The originating beat's canon_facts (beats.canon_facts) that successors must not contradict.
  canonFactsOf(beatId: string): Promise<CanonFacts>;
  // The viewer's cohort_id for cold-start seeding (viewer_state.cohort_id).
  cohortOf(userId: string, seriesId: string): Promise<string | null>;
  // users.adaptive_opt_in. False means always serve the director's cut.
  adaptiveOptIn(userId: string): Promise<boolean>;
}

export type DecideDeps = {
  db: DecisionDB;
  kv: PolicyKV; // hot serving copy of viewer vector and arm models
  logger: DecisionLogger; // async, never a synchronous Postgres insert on the serving path
  cohorts: CohortSeeds; // cold-start population priors
  timeoutMs?: number; // serving timeout override (defaults to config SERVE_TIMEOUT_MS); tests force it
};

// The explainability payload every served decision can emit (PLACEHOLDER 3, the EU AI Act bar): the
// top-N named feature contributions plus the canon filter that bounded the arm set.
export type DecisionExplanation = {
  topFeatures: FeatureContribution[];
  canonReason: string;
  isControl: boolean;
  policyVersion: string;
};

// Internal result so callers (the HTTP layer and tests) can get both the contract response and, when
// they want it, the explanation, without a second decision.
export type DecideResult = { response: DecideResponse; explanation: DecisionExplanation };

const branchOf = (c: { branch?: Branch }): Branch => c.branch ?? "calm";

// Resolve the warm viewer vector: KV hot copy if present, else cold-start from the cohort mean and warm
// KV for next time. Then fold the request's beat signals in (signal capture, design 1).
async function resolveViewerVector(
  deps: DecideDeps,
  userId: string,
  seriesId: string,
  signals: BeatSignals
): Promise<PreferenceVector> {
  let v = await deps.kv.getViewerVector(userId, seriesId);
  if (!v) {
    const cohortId = await deps.db.cohortOf(userId, seriesId);
    v = await deps.cohorts.meanVectorFor(cohortId); // cold start
  }
  const updated = updateVector(v, signals);
  await deps.kv.putViewerVector(userId, seriesId, updated); // write-through to KV (CDC flushes to PG)
  return updated;
}

// Build the canon-safe arm set, run the bandit, and produce the served decision. Throws
// NoSuccessorsError if the arm set is empty after canon filtering. Returns the chosen variant, the
// prefetch hints, the propensity, and the explanation.
async function adaptiveDecision(
  deps: DecideDeps,
  req: DecideRequest,
  seriesId: string,
  candidates: CanonCandidate[],
  canonFacts: CanonFacts
): Promise<{
  variantId: string;
  prefetch: string[];
  propensity: number;
  explanation: Omit<DecisionExplanation, "isControl" | "policyVersion">;
}> {
  // HARD canon pre-filter BEFORE any ranking.
  const filtered = canonFilter(candidates, canonFacts);
  if (filtered.arms.length === 0) throw new NoSuccessorsError();

  const x = toArray(
    await resolveViewerVector(deps, req.user_id, seriesId, (req.signals ?? {}) as BeatSignals)
  );
  const pv = policyVersion();
  const arms = await Promise.all(
    filtered.arms.map(async (a) => ({
      variantId: a.variantId,
      model: await armModelOrPrior(deps.kv, a.variantId, pv),
    }))
  );

  const choice = chooseArm(arms, x, EXPLORATION_ALPHA);
  const prefetch = choice.ranked.slice(0, PREFETCH_TOP_K).map((r) => r.variantId);
  return {
    variantId: choice.chosen.variantId,
    prefetch,
    propensity: choice.propensity,
    explanation: { topFeatures: choice.chosen.topFeatures, canonReason: filtered.reason },
  };
}

// The propensity of a DETERMINISTIC decision (control, opt-out, timeout, error). A deterministic policy
// serves its chosen arm with probability 1, so the logged propensity is 1.0. This is the K1/T1 fix:
// EVERY decision logs a strictly-positive propensity, so IPS/DR never divide by zero and control rows are
// valid in the off-policy dataset (weighted at 1). It does not distort the A/B Adaptive Lift, which
// compares the control and treatment group means directly.
const DETERMINISTIC_PROPENSITY = 1.0;

// The fail-safe director's cut path: deterministic baseline policy over the canon-filtered candidates,
// no KV reads, no exploration. Used for control viewers, opt-out, timeout, and any error.
function directorsCutDecision(
  candidates: CanonCandidate[],
  canonFacts: CanonFacts
): { variantId: string; prefetch: string[]; canonReason: string } {
  const filtered = canonFilter(candidates, canonFacts);
  const arms = filtered.arms.length > 0 ? filtered.arms : candidates; // never less safe than the raw set
  if (arms.length === 0) throw new NoSuccessorsError();
  const chosen = chooseBranch(
    arms.map((a) => ({ variantId: a.variantId, branch: branchOf(a) })),
    {},
    true
  );
  const safe = arms.find((a) => a.variantId === chosen.variantId) ?? directorsCutOf(arms);
  return {
    variantId: safe.variantId,
    prefetch: arms.slice(0, PREFETCH_TOP_K).map((a) => a.variantId),
    canonReason: filtered.reason,
  };
}

// Race the adaptive decision against the hard serving timeout (design 4). On breach the timeout wins
// and the caller falls back to the director's cut. The clock is injectable for deterministic tests.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("serve_timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

// Signed-out viewers (product decision 2026-10-01: guests watch free with a default cut). Serves the
// deterministic director's cut with no per-user reads (no opt-in, no viewer vector, no cohort) and no
// writes: guests are not part of the experiment dataset, so nothing is logged and the decision_id is a
// throwaway. Throws NoSuccessorsError (422) like decide().
export async function decideForGuest(currentBeatId: string, deps: DecideDeps): Promise<DecideResult> {
  const candidates = await deps.db.candidatesOf(currentBeatId);
  if (candidates.length === 0) throw new NoSuccessorsError();
  const canonFacts = await deps.db.canonFactsOf(currentBeatId);
  const dc = directorsCutDecision(candidates, canonFacts);
  const pv = policyVersion();
  return {
    response: {
      decision_id: randomUUID(),
      next_variant_id: dc.variantId,
      prefetch_variant_ids: dc.prefetch,
      is_control: true,
      policy_version: pv,
    },
    explanation: { topFeatures: [], canonReason: dc.canonReason, isControl: true, policyVersion: pv },
  };
}

// The handler. Returns the contract response plus the explanation. Throws NoSuccessorsError (422) only
// when there is genuinely no safe successor. Every other failure mode degrades to the director's cut.
export async function decide(req: DecideRequest, deps: DecideDeps): Promise<DecideResult> {
  const seriesId = await deps.db.seriesOfBeat(req.current_beat_id);
  const candidates = await deps.db.candidatesOf(req.current_beat_id);
  if (candidates.length === 0) throw new NoSuccessorsError();
  const canonFacts = await deps.db.canonFactsOf(req.current_beat_id);

  const isControl = assignControl(req.user_id);
  const optIn = await deps.db.adaptiveOptIn(req.user_id);
  const pv = policyVersion();

  // Control viewers and opt-outs get the deterministic director's cut, never the bandit.
  if (isControl || !optIn) {
    const dc = directorsCutDecision(candidates, canonFacts);
    const decisionId = await deps.logger.log({
      user_id: req.user_id,
      beat_id: req.current_beat_id,
      served_variant_id: dc.variantId,
      is_control: true, // control or opt-out is logged as control for clean lift accounting
      policy_version: pv,
      propensity: DETERMINISTIC_PROPENSITY,
    });
    return {
      response: {
        decision_id: decisionId,
        next_variant_id: dc.variantId,
        prefetch_variant_ids: dc.prefetch,
        is_control: true,
        policy_version: pv,
      },
      explanation: { topFeatures: [], canonReason: dc.canonReason, isControl: true, policyVersion: pv },
    };
  }

  // Treatment: run the bandit under the serving timeout. NoSuccessorsError propagates as a real 422; any
  // other error or a timeout degrades to the director's cut (fail safe).
  try {
    const adaptive = await withTimeout(
      adaptiveDecision(deps, req, seriesId, candidates, canonFacts),
      deps.timeoutMs ?? SERVE_TIMEOUT_MS
    );
    const decisionId = await deps.logger.log({
      user_id: req.user_id,
      beat_id: req.current_beat_id,
      served_variant_id: adaptive.variantId,
      is_control: false,
      policy_version: pv,
      propensity: adaptive.propensity, // 0005 column, for off-policy evaluation
    });
    return {
      response: {
        decision_id: decisionId,
        next_variant_id: adaptive.variantId,
        prefetch_variant_ids: adaptive.prefetch,
        is_control: false,
        policy_version: pv,
      },
      explanation: { ...adaptive.explanation, isControl: false, policyVersion: pv },
    };
  } catch (err) {
    if (err instanceof NoSuccessorsError) throw err; // genuine end of graph, the contract 422
    // Timeout or any other error: serve the director's cut. Caps tail latency, fails safe.
    const dc = directorsCutDecision(candidates, canonFacts);
    const decisionId = await deps.logger.log({
      user_id: req.user_id,
      beat_id: req.current_beat_id,
      served_variant_id: dc.variantId,
      is_control: true, // a degraded decision is the director's cut, accounted as control
      policy_version: pv,
      propensity: DETERMINISTIC_PROPENSITY,
    });
    return {
      response: {
        decision_id: decisionId,
        next_variant_id: dc.variantId,
        prefetch_variant_ids: dc.prefetch,
        is_control: true,
        policy_version: pv,
      },
      explanation: { topFeatures: [], canonReason: dc.canonReason, isControl: true, policyVersion: pv },
    };
  }
}
