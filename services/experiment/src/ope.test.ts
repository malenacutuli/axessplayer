// Off-policy evaluation tests with KNOWN GROUND TRUTH on synthetic logged data. We construct a tiny
// world where the true expected reward of each arm is known, log decisions under a stochastic logging
// policy with recorded propensities, then assert IPS and doubly-robust recover a candidate policy's true
// value within tolerance and stay bounded. This is the safety-gate evidence. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ips, doublyRobust, deployGate, type CandidatePolicy } from "./ope.js";
import { newArmModel, foldSample, type ArmModel } from "./linucb.js";
import { REWARD_MIN, REWARD_MAX } from "./reward-weights.js";
import type { LoggedDecision } from "./dataset.js";

const DIM = 2;

// A seedable LCG so the synthetic log is reproducible without a dependency.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// Ground truth: two arms over a single fixed context x = [1, 0]. Arm A has true mean reward 0.8, arm B
// has true mean reward 0.2. Rewards are deterministic at their means here (no observation noise) so the
// estimator target is exact and the test is about importance-weighting correctness, not variance.
const X = [1, 0];
const TRUE_MEAN: Record<string, number> = { A: 0.8, B: 0.2 };
const ARM_SET = ["A", "B"];

// Logging policy: explores, choosing A with probability 0.6 and B with 0.4, and LOGS those propensities.
function buildLog(n: number, seed: number): LoggedDecision[] {
  const rand = lcg(seed);
  const rows: LoggedDecision[] = [];
  for (let i = 0; i < n; i++) {
    const pickA = rand() < 0.6;
    const variantId = pickA ? "A" : "B";
    const propensity = pickA ? 0.6 : 0.4;
    rows.push({
      decisionId: `d${i}`,
      userId: "u",
      beatId: "b",
      variantId,
      propensity,
      policyVersion: "logging",
      isControl: false,
      context: [...X],
      armSet: [...ARM_SET],
      outcome: { completion: TRUE_MEAN[variantId], returned_within_window: false, monetization_event: false, canon_or_quality_penalty: 0 },
    });
  }
  return rows;
}

// The shaped reward of these synthetic rows is w_c * completion = 1.0 * TRUE_MEAN (returned/monetization
// false, penalty 0). So the observed reward equals TRUE_MEAN[arm], which is the ground-truth value.
const rewardOf = (d: LoggedDecision) => d.outcome.completion;
const fallbackArm = () => newArmModel(DIM);

// A candidate policy that DETERMINISTICALLY prefers arm A: train arm A hard on a high reward and arm B on
// a low one along X, with alpha 0 (pure exploitation), so softmax mass concentrates on A. Its true value
// is therefore close to TRUE_MEAN[A] = 0.8.
function candidatePreferringA(): CandidatePolicy {
  const arms: Record<string, ArmModel> = { A: newArmModel(DIM), B: newArmModel(DIM) };
  for (let i = 0; i < 50; i++) {
    foldSample(arms.A, X, 5); // strong positive evidence on A
    foldSample(arms.B, X, -5); // strong negative on B
  }
  return { arms, alpha: 0, dim: DIM };
}

test("IPS recovers a candidate policy value within tolerance of ground truth", () => {
  const rows = buildLog(4000, 12345);
  const policy = candidatePreferringA();
  const est = ips(rows, policy, { rewardOf, fallbackArm });
  // Candidate concentrates almost all mass on A, whose true mean is 0.8. SNIPS should land near 0.8.
  assert.ok(est.value > 0.7 && est.value < 0.85, `IPS value ${est.value} not near 0.8`);
  // Self-normalized IPS is bounded inside the observed reward range [0.2, 0.8].
  assert.ok(est.value >= 0.2 - 1e-9 && est.value <= 0.8 + 1e-9, `IPS value ${est.value} out of reward range`);
  assert.equal(est.n, 4000);
  assert.ok(est.effectiveSampleSize > 0);
});

test("doubly-robust recovers the same value and stays bounded", () => {
  const rows = buildLog(4000, 999);
  const policy = candidatePreferringA();
  const dr = doublyRobust(rows, policy, { rewardOf, fallbackArm });
  assert.ok(dr.value > 0.7 && dr.value < 0.85, `DR value ${dr.value} not near 0.8`);
  // DR is clamped by the Q-hat bounds and the reward range; it must stay inside the shaping bounds.
  assert.ok(dr.value >= REWARD_MIN - 1e-9 && dr.value <= REWARD_MAX + 1e-9, `DR value ${dr.value} outside shaping bounds`);
});

test("IPS and DR agree closely when the reward model is accurate", () => {
  const rows = buildLog(4000, 7);
  const policy = candidatePreferringA();
  const i = ips(rows, policy, { rewardOf, fallbackArm });
  const d = doublyRobust(rows, policy, { rewardOf, fallbackArm });
  assert.ok(Math.abs(i.value - d.value) < 0.1, `IPS ${i.value} and DR ${d.value} should agree`);
});

test("a candidate that copies the logging policy recovers the logging value", () => {
  // Logging policy value = 0.6*0.8 + 0.4*0.2 = 0.56. A near-uniform candidate (evidence-free arms,
  // alpha 0) places ~0.5 on each arm; over the same arm set its IPS value should land near the data mean.
  const rows = buildLog(6000, 2024);
  const uniform: CandidatePolicy = { arms: { A: newArmModel(DIM), B: newArmModel(DIM) }, alpha: 0, dim: DIM };
  const est = ips(rows, uniform, { rewardOf, fallbackArm });
  // Uniform candidate value = 0.5*0.8 + 0.5*0.2 = 0.5. Allow sampling slack.
  assert.ok(est.value > 0.45 && est.value < 0.55, `uniform-candidate IPS ${est.value} not near 0.5`);
});

test("deployGate accepts a candidate that beats the logged policy and reports both estimates", () => {
  const rows = buildLog(4000, 555);
  const policy = candidatePreferringA();
  const gate = deployGate(rows, policy, { rewardOf, fallbackArm, minEffSampleSize: 10 });
  // logged value ~0.56; candidate ~0.8, so it should clear the gate.
  assert.equal(gate.accept, true, `gate rejected: ${gate.reasons.join("; ")}`);
  assert.ok(gate.ipsEstimate.value > gate.loggedValue, "IPS should show lift");
  assert.ok(gate.drEstimate.value > gate.loggedValue, "DR should show lift");
});

test("deployGate REJECTS a candidate worse than the logged policy", () => {
  const rows = buildLog(4000, 321);
  // Candidate that prefers the BAD arm B.
  const arms: Record<string, ArmModel> = { A: newArmModel(DIM), B: newArmModel(DIM) };
  for (let i = 0; i < 50; i++) {
    foldSample(arms.A, X, -5);
    foldSample(arms.B, X, 5);
  }
  const bad: CandidatePolicy = { arms, alpha: 0, dim: DIM };
  const gate = deployGate(rows, bad, { rewardOf, fallbackArm, minEffSampleSize: 10 });
  assert.equal(gate.accept, false, "a worse policy must not pass the gate");
  assert.ok(gate.reasons.length > 0);
});

test("deployGate refuses when there is no eligible logged data", () => {
  const controlOnly: LoggedDecision[] = buildLog(10, 1).map((r) => ({ ...r, isControl: true }));
  const gate = deployGate(controlOnly, candidatePreferringA(), { rewardOf, fallbackArm });
  assert.equal(gate.accept, false);
  assert.ok(gate.reasons.some((r) => r.includes("no eligible")));
});

test("zero-propensity rows are excluded so IPS never divides by zero", () => {
  const rows = buildLog(100, 2);
  rows[0] = { ...rows[0], propensity: 0 };
  const est = ips(rows, candidatePreferringA(), { rewardOf, fallbackArm });
  assert.equal(est.n, 99); // the zero-propensity row dropped
  assert.ok(Number.isFinite(est.value));
});
