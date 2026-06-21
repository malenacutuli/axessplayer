// Tests for the W3 decision engine: the LinUCB bandit, the canon hard filter, stable control
// assignment with observed-share drift, propensity + policy_version logging, and the timeout director's
// cut fail-safe. Runner: node --test with tsx (NodeNext .js specifiers resolve to .ts). No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { assignControl, chooseBranch, DIRECTORS_CUT } from "./policy.js";
import { canonFilter, type CanonCandidate } from "./canon.js";
import { chooseArm, newArmModel, InMemoryTrainer } from "./bandit.js";
import { FEATURE_DIM, zeroVector, updateVector, toArray, InMemoryCohortSeeds } from "./features.js";
import { decide, NoSuccessorsError, type DecisionDB, type DecideDeps } from "./decide.js";
import { InMemoryKV } from "./kv.js";
import { InMemoryLogger } from "./logger.js";
import { CONTROL_HOLDOUT_PCT, policyVersion } from "./config.js";

// ---- shared fixtures ----

const CALM = "cccccccc-0000-0000-0000-00000000000a";
const TENSE = "cccccccc-0000-0000-0000-00000000000b";
const SERIES = "11111111-1111-1111-1111-111111111111";
const BEAT = "bbbbbbbb-0000-0000-0000-000000000002";

const baseCandidates: CanonCandidate[] = [
  { variantId: CALM, branch: "calm", validEdge: true },
  { variantId: TENSE, branch: "tense", validEdge: true },
];

// A DB stub. Overrides let each test tweak one behavior. adaptiveOptIn defaults to true.
function fakeDB(over: Partial<DecisionDB> = {}): DecisionDB {
  return {
    seriesOfBeat: async () => SERIES,
    candidatesOf: async () => baseCandidates,
    canonFactsOf: async () => ({}),
    cohortOf: async () => null,
    adaptiveOptIn: async () => true,
    ...over,
  };
}

function deps(over: Partial<DecideDeps> = {}): DecideDeps {
  return {
    db: fakeDB(),
    kv: new InMemoryKV(),
    logger: new InMemoryLogger(),
    cohorts: new InMemoryCohortSeeds(),
    ...over,
  };
}

// ---- deterministic baseline policy (the kept fallback) ----

test("baseline: control always gets the director's cut", () => {
  assert.equal(chooseBranch(baseCandidates, { intensity: 5 }, true).branch, DIRECTORS_CUT);
});

test("baseline: treatment high intensity gets tense, low gets calm, unknown falls back to calm", () => {
  assert.equal(chooseBranch(baseCandidates, { intensity: 5 }, false).branch, "tense");
  assert.equal(chooseBranch(baseCandidates, { intensity: 2 }, false).branch, "calm");
  assert.equal(chooseBranch(baseCandidates, {}, false).branch, "calm");
});

// ---- bandit determinism ----

test("bandit is deterministic given the same arms and context", () => {
  const x = toArray({ ...zeroVector(), completion_rate: 0.8, intensity_ema: 0.9 });
  const arms = [
    { variantId: CALM, model: newArmModel() },
    { variantId: TENSE, model: newArmModel() },
  ];
  const a = chooseArm(arms, x);
  const b = chooseArm(arms, x);
  assert.equal(a.chosen.variantId, b.chosen.variantId);
  assert.equal(a.propensity, b.propensity);
  assert.ok(a.propensity > 0 && a.propensity <= 1, `propensity in (0,1]: ${a.propensity}`);
  // The chosen arm emits its top-N named feature contributions (the explainability bar).
  assert.ok(a.chosen.topFeatures.length > 0);
  assert.ok(a.chosen.topFeatures.every((f) => typeof f.feature === "string"));
});

test("trained arm shifts the choice (LinUCB update math is real, on supplied samples)", async () => {
  const trainer = new InMemoryTrainer();
  const x = toArray({ ...zeroVector(), intensity_ema: 1, completion_rate: 1 });
  // Reward TENSE strongly for this context.
  const models = await trainer.train([
    { variantId: TENSE, x, reward: 1 },
    { variantId: TENSE, x, reward: 1 },
    { variantId: TENSE, x, reward: 1 },
  ]);
  const arms = [
    { variantId: CALM, model: newArmModel() },
    { variantId: TENSE, model: models.get(TENSE)! },
  ];
  // With exploration off (alpha 0) the trained TENSE arm now wins on the exploitation term.
  assert.equal(chooseArm(arms, x, 0).chosen.variantId, TENSE);
});

// ---- canon hard filter ----

test("canon filter removes an invalid edge so the bandit can never choose it", () => {
  const planted: CanonCandidate[] = [
    { variantId: CALM, branch: "calm", validEdge: true },
    { variantId: TENSE, branch: "tense", validEdge: false }, // invalid edge
  ];
  const x = toArray({ ...zeroVector(), intensity_ema: 1 }); // a context that would favor tense
  const { arms } = canonFilter(planted, {});
  assert.deepEqual(
    arms.map((a) => a.variantId),
    [CALM]
  );
  const choice = chooseArm(
    arms.map((a) => ({ variantId: a.variantId, model: newArmModel() })),
    x
  );
  assert.equal(choice.chosen.variantId, CALM); // invalid arm was never even ranked
});

test("canon filter removes a variant that contradicts the beat's canon_facts", () => {
  const required = { villain_alive: true };
  const candidates: CanonCandidate[] = [
    { variantId: CALM, branch: "calm", validEdge: true, asserts: { villain_alive: true } },
    { variantId: TENSE, branch: "tense", validEdge: true, asserts: { villain_alive: false } }, // breaks canon
  ];
  const { arms, rejected } = canonFilter(candidates, required);
  assert.deepEqual(
    arms.map((a) => a.variantId),
    [CALM]
  );
  assert.deepEqual(
    rejected.map((a) => a.variantId),
    [TENSE]
  );
});

test("end to end: a planted invalid edge is never served", async () => {
  const db = fakeDB({
    candidatesOf: async () => [
      { variantId: CALM, branch: "calm", validEdge: true },
      { variantId: TENSE, branch: "tense", validEdge: false },
    ],
  });
  const userId = pickTreatmentId();
  const res = await decide({ user_id: userId, current_beat_id: BEAT, signals: {} }, deps({ db }));
  assert.equal(res.response.next_variant_id, CALM);
  assert.ok(!(res.response.prefetch_variant_ids ?? []).includes(TENSE));
});

// ---- stable + drift control share ----

test("control assignment is stable per user across calls", () => {
  for (const id of ["user-123", "abc", "9f"]) {
    assert.equal(assignControl(id), assignControl(id));
  }
});

test("realized control share is bounded near the configured rate (drift expected on finite ids)", () => {
  const N = 20000;
  let control = 0;
  for (let i = 0; i < N; i++) if (assignControl("user-" + i, CONTROL_HOLDOUT_PCT)) control++;
  const share = (100 * control) / N;
  // Print the OBSERVED share. The design names the drift caveat: a hash-bucket over a finite id set
  // does not land exactly on the nominal boundary; it converges on a real population of millions.
  console.log(
    `observed control share: ${share.toFixed(2)}% over ${N} ids (configured ${CONTROL_HOLDOUT_PCT}%)`
  );
  assert.ok(
    Math.abs(share - CONTROL_HOLDOUT_PCT) <= 3,
    `control share ${share.toFixed(2)}% drifted more than 3 points from ${CONTROL_HOLDOUT_PCT}%`
  );
});

// ---- handler shape, logging, control/opt-out, timeout ----

test("handler response matches the contract shape", async () => {
  const res = await decide(
    { user_id: pickTreatmentId(), current_beat_id: BEAT, signals: { completion: 0.9 } },
    deps()
  );
  const r = res.response;
  assert.match(r.decision_id, /^[0-9a-f-]{36}$/);
  assert.ok(r.next_variant_id);
  assert.ok(Array.isArray(r.prefetch_variant_ids));
  assert.equal(typeof r.is_control, "boolean");
  assert.equal(r.policy_version, policyVersion());
});

test("treatment decision logs propensity and policy_version", async () => {
  const logger = new InMemoryLogger();
  await decide({ user_id: pickTreatmentId(), current_beat_id: BEAT, signals: {} }, deps({ logger }));
  assert.equal(logger.rows.length, 1);
  const row = logger.rows[0];
  assert.equal(row.is_control, false);
  assert.equal(row.policy_version, policyVersion());
  assert.ok(
    typeof row.propensity === "number" && row.propensity > 0,
    `propensity logged: ${row.propensity}`
  );
});

test("control viewer is served the director's cut and logged with a deterministic propensity of 1", async () => {
  const logger = new InMemoryLogger();
  const res = await decide(
    { user_id: pickControlId(), current_beat_id: BEAT, signals: {} },
    deps({ logger })
  );
  assert.equal(res.response.is_control, true);
  assert.equal(res.response.next_variant_id, CALM); // director's cut (calm)
  // T1: a deterministic control decision logs propensity 1 (not null), so it is valid off-policy.
  assert.equal(logger.rows[0].propensity, 1);
});

test("opt-out viewer is served the director's cut even in the treatment bucket", async () => {
  const logger = new InMemoryLogger();
  const db = fakeDB({ adaptiveOptIn: async () => false });
  const res = await decide(
    { user_id: pickTreatmentId(), current_beat_id: BEAT, signals: {} },
    deps({ db, logger })
  );
  assert.equal(res.response.is_control, true);
  assert.equal(res.response.next_variant_id, CALM);
});

test("timeout returns the director's cut (fail safe)", async () => {
  const logger = new InMemoryLogger();
  // Make the cold-start cohort read hang so the adaptive path cannot finish before the timeout.
  const slowCohorts = {
    meanVectorFor: () => new Promise<never>(() => {}), // never resolves
  };
  const res = await decide(
    { user_id: pickTreatmentId(), current_beat_id: BEAT, signals: {} },
    deps({ logger, cohorts: slowCohorts, timeoutMs: 5 })
  );
  assert.equal(res.response.is_control, true); // degraded to director's cut
  assert.equal(res.response.next_variant_id, CALM);
  assert.equal(logger.rows[0].propensity, 1); // T1: the fail-safe path still logs a deterministic propensity
});

// T1 REGRESSION GUARD: no decision path may persist a null/invalid propensity. Drive control, treatment,
// opt-out, and timeout through the handler and assert every logged row carries a propensity in (0, 1]; and
// that the logger itself rejects an invalid propensity at the boundary.
test("every decision path logs a strictly-positive propensity (never null) - T1 regression", async () => {
  const logger = new InMemoryLogger();
  await decide({ user_id: pickControlId(), current_beat_id: BEAT, signals: {} }, deps({ logger }));
  await decide({ user_id: pickTreatmentId(), current_beat_id: BEAT, signals: {} }, deps({ logger }));
  await decide({ user_id: pickTreatmentId(), current_beat_id: BEAT, signals: {} }, deps({ db: fakeDB({ adaptiveOptIn: async () => false }), logger }));
  await decide(
    { user_id: pickTreatmentId(), current_beat_id: BEAT, signals: {} },
    deps({ logger, cohorts: { meanVectorFor: () => new Promise<never>(() => {}) }, timeoutMs: 5 }),
  );
  assert.equal(logger.rows.length, 4);
  for (const row of logger.rows) {
    assert.ok(typeof row.propensity === "number" && row.propensity > 0 && row.propensity <= 1, `propensity in (0,1]: ${row.propensity}`);
  }
  // the boundary guard rejects an invalid propensity outright
  await assert.rejects(() => new InMemoryLogger().log({ user_id: "u", beat_id: "b", served_variant_id: "v", is_control: true, policy_version: "p", propensity: null as unknown as number }), /invalid propensity/);
});

test("end of graph raises the contract 422 no_successors", async () => {
  const db = fakeDB({ candidatesOf: async () => [] });
  await assert.rejects(
    decide({ user_id: pickTreatmentId(), current_beat_id: BEAT, signals: {} }, deps({ db })),
    (e: unknown) => e instanceof NoSuccessorsError && (e as NoSuccessorsError).status === 422
  );
});

test("all-canon-violating arm set raises 422 (no safe successor)", async () => {
  const db = fakeDB({
    candidatesOf: async () => [{ variantId: CALM, branch: "calm", validEdge: false }],
    canonFactsOf: async () => ({}),
  });
  await assert.rejects(
    decide({ user_id: pickTreatmentId(), current_beat_id: BEAT, signals: {} }, deps({ db })),
    NoSuccessorsError
  );
});

// ---- feature vector ----

test("feature vector dimension matches and EMA update folds signals", () => {
  const z = zeroVector();
  assert.equal(toArray(z).length, FEATURE_DIM);
  const next = updateVector(z, { completion: 1, dwell_ms: 60000, replays: 3, skipped: false });
  assert.ok(next.completion_rate > 0 && next.completion_rate <= 1);
  assert.ok(next.avg_dwell > 0);
  assert.ok(next.replay_rate > 0);
});

// ---- helpers: pick ids that land in a known bucket so handler tests are deterministic ----

function pickTreatmentId(): string {
  for (let i = 0; i < 1000; i++) {
    const id = "treatment-" + i;
    if (!assignControl(id)) return id;
  }
  throw new Error("no treatment id found");
}
function pickControlId(): string {
  for (let i = 0; i < 1000; i++) {
    const id = "control-" + i;
    if (assignControl(id)) return id;
  }
  throw new Error("no control id found");
}
