// T3 / K3: the Outcome Joiner. Attaches delayed outcomes (continuation, D1/D7 return, unlock, revenue) back
// to each decision_id and produces the full matched triple (context, chosen arm, propensity, is_control,
// reward) the trainer and the off-policy estimators consume. The join key is engagement_events.decision_id
// (now carried end to end through the AXP emit path); a decision with no attributed event still appears as a
// triple with a zero outcome, so coverage is honest and every decision is queryable. No new infra, a single
// group-by over Postgres rows. No em dashes.

import type { LoggedDecision } from "./dataset.js";
import type { AttributedOutcome } from "./reward-weights.js";

// The bare decision_log row the joiner needs (read-only). context + armSet are the off-policy fields the bare
// table does not persist; they are supplied by the caller's snapshot (viewer_state at decision time + the
// canon-filtered arm set), defaulting to empty when unavailable.
export interface DecisionRow {
  id: string;
  userId: string;
  beatId: string;
  servedVariantId: string;
  isControl: boolean;
  propensity: number;
  policyVersion: string;
  context?: number[];
  armSet?: string[];
}

// The engagement_events row the joiner reads. decisionId is the join key; type/completion/ts/payload derive
// the outcome. Events with a null decisionId are not the consequence of a decision and are ignored.
export interface EventRow {
  decisionId: string | null;
  type: string;
  completion: number | null;
  ts: number;
  payload?: Record<string, unknown> | null;
}

// Which event types signal each outcome dimension. Editable config, not magic strings scattered in code.
const RETURN_EVENTS = new Set(["continue_resumed", "series_opened", "episode_completed"]);
const COMPLETION_EVENTS = new Set(["beat_completed", "completion_50", "episode_completed"]);
const MONETIZATION_EVENTS = new Set(["unlock_purchased", "premium_cut_purchased", "credits_spent"]);

// Derive the attributed outcome for one decision from its joined events. completion is the max observed beat
// completion; returned_within_window is any return-class event after the decision inside the window; a
// monetization event is any spend. A decision with no events yields a clean zero outcome (not a fabricated one).
export function deriveOutcome(decisionTs: number, events: EventRow[], opts: { returnWindowDays?: number } = {}): AttributedOutcome {
  const windowMs = (opts.returnWindowDays ?? 7) * 24 * 60 * 60 * 1000;
  let completion = 0;
  let returned = false;
  let monetized = false;
  for (const e of events) {
    if (typeof e.completion === "number" && COMPLETION_EVENTS.has(e.type)) completion = Math.max(completion, clamp01(e.completion));
    if (RETURN_EVENTS.has(e.type) && e.ts > decisionTs && e.ts - decisionTs <= windowMs) returned = true;
    if (MONETIZATION_EVENTS.has(e.type)) monetized = true;
  }
  return { completion, returned_within_window: returned, monetization_event: monetized, canon_or_quality_penalty: 0 };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export interface JoinCoverage {
  decisions: number;
  withOutcome: number; // decisions that joined at least one attributed event
  rate: number; // withOutcome / decisions
  orphanEvents: number; // events whose decision_id matched no decision (data-quality signal)
}

export interface OutcomeJoinResult {
  triples: LoggedDecision[]; // one per decision, the full matched triple (zero outcome when unjoined)
  coverage: JoinCoverage;
}

// Join decisions to their outcome events on decision_id and produce the matched triples. Every decision
// becomes a triple; coverage reports how many actually carried an attributed event. The decision ts is taken
// from the earliest event with that id when not supplied (so the window check has a reference).
export function joinOutcomes(
  decisions: readonly DecisionRow[],
  events: readonly EventRow[],
  opts: { returnWindowDays?: number; decisionTs?: (id: string) => number } = {},
): OutcomeJoinResult {
  const byDecision = new Map<string, EventRow[]>();
  let orphanEvents = 0;
  const decisionIds = new Set(decisions.map((d) => d.id));
  for (const e of events) {
    if (e.decisionId == null) continue; // not decision-driven
    if (!decisionIds.has(e.decisionId)) {
      orphanEvents++;
      continue;
    }
    const arr = byDecision.get(e.decisionId) ?? [];
    arr.push(e);
    byDecision.set(e.decisionId, arr);
  }

  let withOutcome = 0;
  const triples: LoggedDecision[] = decisions.map((d) => {
    const evs = byDecision.get(d.id) ?? [];
    if (evs.length > 0) withOutcome++;
    const refTs = opts.decisionTs ? opts.decisionTs(d.id) : Math.min(...evs.map((e) => e.ts), Number.POSITIVE_INFINITY);
    const outcome = deriveOutcome(Number.isFinite(refTs) ? refTs : 0, evs, { returnWindowDays: opts.returnWindowDays });
    return {
      decisionId: d.id,
      userId: d.userId,
      beatId: d.beatId,
      variantId: d.servedVariantId, // the chosen arm
      propensity: d.propensity,
      policyVersion: d.policyVersion,
      isControl: d.isControl,
      context: d.context ?? [],
      armSet: d.armSet ?? [],
      outcome,
    };
  });

  return {
    triples,
    coverage: { decisions: decisions.length, withOutcome, rate: decisions.length === 0 ? 0 : withOutcome / decisions.length, orphanEvents },
  };
}

// Single-objective reward for the lift readout: D7 return (continuation). Returns 1 when the decision's
// viewer returned within the window, else 0. The matched triple keeps the full AttributedOutcome; this is the
// scalar the Adaptive Lift compares across control and treatment.
export function d7Reward(triple: LoggedDecision): number {
  return triple.outcome.returned_within_window ? 1 : 0;
}
