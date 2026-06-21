// END-TO-END data-moat validation: decision -> engagement event (carrying decision_id) -> Outcome Joiner
// (T3) -> matched triple -> Adaptive Lift (T4) and off-policy IPS (T6). Proves the whole loop closes on the
// decision_id key and recovers a planted lift, with clean propensity throughout. Deterministic (seeded RNG),
// no network, no DB. No em dashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { joinOutcomes, d7Reward, type DecisionRow, type EventRow } from "./outcome-joiner.js";
import { adaptiveLift, type ImpressionRecord } from "./gatea/readout.js";
import { ips, type CandidatePolicy } from "./ope.js";
import { newArmModel } from "./linucb.js";
import type { LoggedDecision } from "./dataset.js";

const DIM = 4;
const ARMS = ["calm", "tense"];

// A small deterministic RNG so the test is reproducible (no Math.random).
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Synthesize a cohort that flows through the (decision -> event with decision_id) shapes. Control serves the
// director's cut (deterministic, propensity 1.0); treatment serves the adapted arm with a softmax-style
// propensity in (0,1]. The treatment arm returns at a higher rate (the PLANTED lift) when planted=true.
function cohort(opts: { viewers: number; controlRate: number; p0: number; treatmentReturn: number; seed: number }) {
  const r = rng(opts.seed);
  const decisions: DecisionRow[] = [];
  const events: EventRow[] = [];
  for (let i = 0; i < opts.viewers; i++) {
    const id = `d-${i}`;
    const isControl = r() < opts.controlRate;
    const variantId = isControl ? "calm" : r() < 0.5 ? "tense" : "calm";
    // adaptive propensity in (0,1]; control is deterministic 1.0 (the T1 rule).
    const propensity = isControl ? 1.0 : 0.5 + r() * 0.5;
    const context = Array.from({ length: DIM }, () => r());
    decisions.push({ id, userId: `u-${i}`, beatId: "beat-1", servedVariantId: variantId, isControl, propensity, policyVersion: "linucb-test", context, armSet: ARMS });
    // every decision yields a beat_completed (the completion outcome) ...
    const completion = 0.6 + r() * 0.4;
    events.push({ decisionId: id, type: "beat_completed", completion, ts: 1000 + i });
    // ... and, with the arm's return probability, a continue_resumed within the window (the D7 return signal).
    const pReturn = isControl ? opts.p0 : opts.treatmentReturn;
    if (r() < pReturn) events.push({ decisionId: id, type: "continue_resumed", completion: null, ts: 1000 + i + 10 });
  }
  // a couple of orphan events (decision_id matching no decision) to exercise the data-quality counter.
  events.push({ decisionId: "ghost-1", type: "continue_resumed", completion: null, ts: 9 });
  events.push({ decisionId: null, type: "search_performed", completion: null, ts: 9 }); // not decision-driven
  return { decisions, events };
}

// Map a matched triple to the ImpressionRecord shape the Adaptive Lift readout consumes. adaptiveLift only
// reads arm, viewerId, d7_return, series_completed; the rest are filled with honest defaults.
function toImpression(t: LoggedDecision): ImpressionRecord {
  return {
    viewerId: t.userId,
    sessionId: t.userId,
    beatId: t.beatId,
    variantId: t.variantId,
    arm: t.isControl ? "control" : "treatment",
    propensity: t.propensity,
    policyVersion: t.policyVersion,
    ts: 0,
    surrogate: { beat_completion: t.outcome.completion, session_continuation: t.outcome.returned_within_window, next_session_within_24h: t.outcome.returned_within_window },
    d1_return: t.outcome.returned_within_window,
    d7_return: t.outcome.returned_within_window,
    series_completed: t.outcome.completion >= 0.95,
    paywall_converted: t.outcome.monetization_event,
    skip_rage: false,
  };
}

test("E2E: the Outcome Joiner closes the matched triple on decision_id with honest coverage", () => {
  const { decisions, events } = cohort({ viewers: 4000, controlRate: 0.5, p0: 0.3, treatmentReturn: 0.46, seed: 7 });
  const { triples, coverage } = joinOutcomes(decisions, events);
  assert.equal(triples.length, decisions.length, "one triple per decision");
  assert.equal(coverage.withOutcome, decisions.length, "every decision joined its beat_completed outcome");
  assert.equal(coverage.rate, 1);
  assert.equal(coverage.orphanEvents, 1, "the ghost decision_id is counted, the null-decision event ignored");
  // every triple is queryable as (context, chosen_arm, propensity, is_control, reward) - the T3 DoD
  for (const t of triples) {
    assert.equal(t.context.length, DIM);
    assert.ok(ARMS.includes(t.variantId));
    assert.ok(t.propensity > 0 && t.propensity <= 1, "clean propensity carried through the join");
    assert.equal(typeof t.isControl, "boolean");
    assert.ok(t.outcome && typeof t.outcome.returned_within_window === "boolean");
  }
});

test("E2E: Adaptive Lift recovers the planted lift from the joined triples, CI excludes zero", () => {
  const { decisions, events } = cohort({ viewers: 4000, controlRate: 0.5, p0: 0.3, treatmentReturn: 0.46, seed: 11 });
  const { triples } = joinOutcomes(decisions, events);
  const lift = adaptiveLift(triples.map(toImpression), { objective: "d7_return" });
  assert.ok(lift.adaptedRate > lift.controlRate, "treatment returns more than control");
  assert.ok(lift.relativeLift !== null && lift.relativeLift > 0, `positive relative lift: ${lift.relativeLift}`);
  assert.ok(lift.ciLo !== null && lift.ciLo > 0, `CI excludes zero: lo=${lift.ciLo}`);
});

test("E2E: a flat cohort (no planted lift) yields a CI that straddles zero (no false positive)", () => {
  const { decisions, events } = cohort({ viewers: 4000, controlRate: 0.5, p0: 0.35, treatmentReturn: 0.35, seed: 13 });
  const { triples } = joinOutcomes(decisions, events);
  const lift = adaptiveLift(triples.map(toImpression), { objective: "d7_return" });
  assert.ok(lift.ciLo !== null && lift.ciHi !== null && lift.ciLo < 0 && lift.ciHi > 0, `flat CI straddles zero: [${lift.ciLo}, ${lift.ciHi}]`);
});

test("E2E: the joined triples are off-policy ready - IPS (T6) runs and returns a finite estimate", () => {
  const { decisions, events } = cohort({ viewers: 2000, controlRate: 0.3, p0: 0.3, treatmentReturn: 0.45, seed: 5 });
  const { triples } = joinOutcomes(decisions, events);
  const policy: CandidatePolicy = { arms: { calm: newArmModel(DIM), tense: newArmModel(DIM) }, alpha: 0, dim: DIM };
  const est = ips(triples, policy, { rewardOf: d7Reward, fallbackArm: () => newArmModel(DIM) });
  assert.ok(Number.isFinite(est.value), `IPS value is finite (clean propensity): ${est.value}`);
  assert.ok(est.value >= 0, "D7 reward is non-negative so its IPS estimate is too");
});
