// Real-Postgres integration: insert decisions into decision_log (including the 0005 propensity column)
// on an embedded Postgres seeded with migrations 0001..0005, read them back through PgDecisionSource,
// then train and run the off-policy estimators on the REAL logged dataset. This is the "reads
// decision_log from real Postgres" DoD line. The DB read is real; the enricher (context/armSet/outcome)
// is the FLAGGED warehouse-join boundary, supplied here from the reward JSONB we wrote. No em dashes.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { startPg, type PgHandle } from "./pgharness.js";
import { PgDecisionSource, type DecisionLogRow } from "../src/pg-source.js";
import { trainModels } from "../src/trainer.js";
import { ips, doublyRobust, type CandidatePolicy } from "../src/ope.js";
import { newArmModel, foldSample, type ArmModel } from "../src/linucb.js";
import type { AttributedOutcome } from "../src/reward-weights.js";

// Seed fixture ids (supabase/seed.sql).
const USER = "aaaaaaaa-0000-0000-0000-000000000001";
const BEAT = "bbbbbbbb-0000-0000-0000-000000000002";
const CALM = "cccccccc-0000-0000-0000-00000000000a";
const TENSE = "cccccccc-0000-0000-0000-00000000000b";
const DIM = 2;
const X = [1, 0];
const ARM_SET = [CALM, TENSE];

// Ground truth: TENSE completes well, CALM does not. We persist the outcome in the reward JSONB and have
// the enricher decode it, so the off-policy reward is reconstructed from a real column.
const TRUE_COMPLETION: Record<string, number> = { [CALM]: 0.2, [TENSE]: 0.8 };

let pg: PgHandle;

before(async () => {
  pg = await startPg();
}, { timeout: 120_000 });

after(async () => {
  if (pg) await pg.stop();
});

test("PgDecisionSource reads decision_log (with propensity) from real Postgres and feeds OPE", async () => {
  // Insert a stochastic logging policy's decisions into the REAL decision_log. CALM chosen 60% at
  // propensity 0.6, TENSE 40% at 0.4. The attributed outcome lives in the reward JSONB column.
  const N = 200;
  let inserted = 0;
  for (let i = 0; i < N; i++) {
    const pickCalm = i % 5 < 3; // 60% CALM, deterministic so the test is stable
    const variant = pickCalm ? CALM : TENSE;
    const propensity = pickCalm ? 0.6 : 0.4;
    const outcome: AttributedOutcome = {
      completion: TRUE_COMPLETION[variant],
      returned_within_window: false,
      monetization_event: false,
      canon_or_quality_penalty: 0,
    };
    await pg.pool.query(
      `INSERT INTO decision_log (user_id, beat_id, served_variant_id, is_control, policy_version, propensity, reward)
       VALUES ($1,$2,$3,false,$4,$5,$6)`,
      [USER, BEAT, variant, "logging-v1", propensity, JSON.stringify(outcome)]
    );
    inserted++;
  }
  // One control row: no propensity, must be read but excluded from policy updates / OPE.
  await pg.pool.query(
    `INSERT INTO decision_log (user_id, beat_id, served_variant_id, is_control, policy_version, propensity, reward)
     VALUES ($1,$2,$3,true,$4,NULL,$5)`,
    [USER, BEAT, CALM, "control", JSON.stringify({ completion: 0.2, returned_within_window: false, monetization_event: false, canon_or_quality_penalty: 0 })]
  );

  // Sanity: the rows are really in Postgres, and the propensity column from 0005 is populated.
  const count = await pg.pool.query<{ c: string; nn: string }>(
    "SELECT count(*) c, count(propensity) nn FROM decision_log WHERE policy_version = 'logging-v1'"
  );
  assert.equal(Number(count.rows[0].c), inserted);
  assert.equal(Number(count.rows[0].nn), inserted); // every non-control row has a propensity

  // Enricher: the FLAGGED boundary. Decode the reward JSONB and supply the fixed context + arm set.
  const enrich = (row: DecisionLogRow) => ({
    context: [...X],
    armSet: [...ARM_SET],
    outcome: row.reward as AttributedOutcome,
  });
  const source = new PgDecisionSource(pg.pool, enrich);
  const rows = await source.load();

  // The control row is read (propensity defaulted to 1 for control), the non-control rows carry their
  // logged propensity. Total = inserted + 1 control. No non-control row was skipped (all had propensity).
  assert.equal(source.skippedNullPropensity, 0);
  assert.equal(rows.length, inserted + 1);
  const nonControl = rows.filter((r) => !r.isControl);
  assert.equal(nonControl.length, inserted);
  assert.ok(nonControl.every((r) => r.propensity === 0.6 || r.propensity === 0.4));

  // Train on the REAL logged dataset. Control excluded automatically.
  const trained = trainModels(rows, { dim: DIM, alpha: 1.0, basePolicyVersion: "linucb-0.1.0", now: () => new Date("2026-06-15T00:00:00Z") });
  assert.equal(trained.snapshot.trainedFromDecisions, inserted);
  assert.ok(trained.arms[CALM] && trained.arms[TENSE]);

  // Off-policy evaluate a candidate that prefers TENSE (true mean 0.8) against the real log.
  const arms: Record<string, ArmModel> = { [CALM]: newArmModel(DIM), [TENSE]: newArmModel(DIM) };
  for (let i = 0; i < 50; i++) {
    foldSample(arms[CALM], X, -5);
    foldSample(arms[TENSE], X, 5);
  }
  const candidate: CandidatePolicy = { arms, alpha: 0, dim: DIM };
  const rewardOf = (d: { outcome: AttributedOutcome }) => d.outcome.completion;
  const fallbackArm = () => newArmModel(DIM);

  const i = ips(rows, candidate as any, { rewardOf: rewardOf as any, fallbackArm });
  const dr = doublyRobust(rows, candidate as any, { rewardOf: rewardOf as any, fallbackArm });

  // Candidate concentrates on TENSE whose true completion is 0.8; both estimators should land near 0.8,
  // bounded inside the observed reward range [0.2, 0.8], computed from data that lived in real Postgres.
  assert.ok(i.value > 0.7 && i.value <= 0.8 + 1e-9, `real-pg IPS ${i.value} not near 0.8`);
  assert.ok(dr.value > 0.6 && dr.value <= 0.8 + 1e-9, `real-pg DR ${dr.value} not near 0.8`);
  assert.equal(i.n, inserted); // control excluded from the estimate
});
