// Trainer tests: deterministic parameter updates given a fixed input ordering and clock, control rows
// excluded, reward shaping matches the ratified weights, and the published snapshot carries a content-
// stamped policy_version. No em dashes. Runner: node --test with tsx.

import { test } from "node:test";
import assert from "node:assert/strict";

import { trainModels, runTrainingLoop, type TrainConfig } from "./trainer.js";
import { InMemorySource, type LoggedDecision } from "./dataset.js";
import { InMemoryKV } from "./kv.js";
import { shapeReward, REWARD_WEIGHTS } from "./reward-weights.js";
import { meanReward, newArmModel } from "./linucb.js";

const DIM = 9;
const fixedClock = () => new Date("2026-06-15T00:00:00.000Z");
const cfg: TrainConfig = { dim: DIM, alpha: 1.0, basePolicyVersion: "linucb-0.1.0", now: fixedClock };

function row(over: Partial<LoggedDecision>): LoggedDecision {
  return {
    decisionId: over.decisionId ?? "d",
    userId: "u",
    beatId: "b",
    variantId: over.variantId ?? "A",
    propensity: over.propensity ?? 0.5,
    policyVersion: "linucb-0.1.0+alpha=1",
    isControl: over.isControl ?? false,
    context: over.context ?? Array(DIM).fill(0.5),
    armSet: over.armSet ?? ["A", "B"],
    outcome: over.outcome ?? { completion: 1, returned_within_window: false, monetization_event: false, canon_or_quality_penalty: 0 },
  };
}

test("reward shaping uses the ratified weights verbatim", () => {
  assert.equal(REWARD_WEIGHTS.w_c, 1.0);
  assert.equal(REWARD_WEIGHTS.w_r, 0.5);
  assert.equal(REWARD_WEIGHTS.w_m, 0.3);
  assert.equal(REWARD_WEIGHTS.w_p, 2.0);
  // full positive: completion 1, returned, monetization, no penalty -> 1 + 0.5 + 0.3 - 0 = 1.8
  assert.equal(shapeReward({ completion: 1, returned_within_window: true, monetization_event: true, canon_or_quality_penalty: 0 }), 1.8);
  // full penalty pulls it to 1.8 - 2.0 = -0.2
  assert.ok(Math.abs(shapeReward({ completion: 1, returned_within_window: true, monetization_event: true, canon_or_quality_penalty: 1 }) - -0.2) < 1e-12);
});

test("training is deterministic given a fixed ordering and clock", () => {
  const rows = [
    row({ variantId: "A", context: [1, 0, 0, 0, 0, 0, 0, 0, 0], outcome: { completion: 1, returned_within_window: true, monetization_event: false, canon_or_quality_penalty: 0 } }),
    row({ variantId: "B", context: [0, 1, 0, 0, 0, 0, 0, 0, 0], outcome: { completion: 0, returned_within_window: false, monetization_event: false, canon_or_quality_penalty: 1 } }),
  ];
  const a = trainModels(rows, cfg);
  const b = trainModels(rows, cfg);
  assert.equal(a.snapshot.policyVersion, b.snapshot.policyVersion);
  assert.deepEqual(a.arms["A"].b, b.arms["A"].b);
  assert.deepEqual(a.arms["B"].A, b.arms["B"].A);
  // The version is content-stamped: a different dataset yields a different version.
  const c = trainModels([rows[0]], cfg);
  assert.notEqual(a.snapshot.policyVersion, c.snapshot.policyVersion);
});

test("control rows do not update arm parameters", () => {
  const rows = [
    row({ variantId: "A", isControl: true, context: [1, 0, 0, 0, 0, 0, 0, 0, 0] }),
    row({ variantId: "A", isControl: false, context: [1, 0, 0, 0, 0, 0, 0, 0, 0], outcome: { completion: 1, returned_within_window: false, monetization_event: false, canon_or_quality_penalty: 0 } }),
  ];
  const r = trainModels(rows, cfg);
  assert.equal(r.snapshot.trainedFromDecisions, 1); // only the non-control row counted
  assert.equal(r.rewardsByArm["A"].length, 1);
});

test("a positive-completion arm learns a higher mean reward than a penalized arm", () => {
  // Arm GOOD always completes with no penalty; arm BAD never completes and carries a canon penalty.
  // Both share the same context direction so theta.x is directly comparable.
  const x = [1, 0, 0, 0, 0, 0, 0, 0, 0];
  const rows: LoggedDecision[] = [];
  for (let i = 0; i < 20; i++) {
    rows.push(row({ variantId: "GOOD", context: x, outcome: { completion: 1, returned_within_window: true, monetization_event: false, canon_or_quality_penalty: 0 } }));
    rows.push(row({ variantId: "BAD", context: x, outcome: { completion: 0, returned_within_window: false, monetization_event: false, canon_or_quality_penalty: 1 } }));
  }
  const r = trainModels(rows, cfg);
  const good = meanReward(r.arms["GOOD"], x);
  const bad = meanReward(r.arms["BAD"], x);
  assert.ok(good > bad, `GOOD ${good} should beat BAD ${bad}`);
  assert.ok(good > 0, "GOOD mean reward should be positive");
  assert.ok(bad < 0, "BAD mean reward should be negative (penalty dominates)");
});

test("runTrainingLoop publishes the trained snapshot to the KV", async () => {
  const rows = [row({ variantId: "A", context: [1, 0, 0, 0, 0, 0, 0, 0, 0] })];
  const kv = new InMemoryKV();
  const result = await runTrainingLoop(new InMemorySource(rows), kv, cfg);
  const current = await kv.current();
  assert.ok(current);
  assert.equal(current!.policyVersion, result.snapshot.policyVersion);
  assert.equal(current!.trainedAt, "2026-06-15T00:00:00.000Z"); // fixed clock
  assert.equal(current!.dim, DIM);
  assert.ok(current!.arms["A"]);
});

test("an empty dataset still produces a valid, publishable empty policy", () => {
  const r = trainModels([], cfg);
  assert.equal(r.snapshot.trainedFromDecisions, 0);
  assert.deepEqual(r.arms, {});
  // newArmModel sanity: identity prior is well formed at this dim.
  assert.equal(newArmModel(DIM).b.length, DIM);
});
