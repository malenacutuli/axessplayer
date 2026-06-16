// Prompt 01 Gate A harness tests. Spec-derived invariants (not implementation-mirrored): stable arm
// split, honest epsilon-greedy propensity, bounded surrogate, a shrinking always-valid radius, and the
// end-to-end readout giving green on a planted lift and NOT green when flat. No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assignArm } from "./arm.js";
import { selectTreatment, controlImpression, seededRng, type Variant } from "./policy.js";
import { surrogateReward, correlation } from "./surrogate.js";
import { alwaysValidRadius, gateAReadout, snipsBand } from "./readout.js";
import { simulateExperiment, greedyCandidateProb } from "./simulate.js";
import { logImpressions, impressionParams, type SqlClient } from "./log.js";

describe("T2 arm assignment", () => {
  it("is stable per viewer and splits about 50/50", () => {
    assert.equal(assignArm("abc"), assignArm("abc"));
    let treat = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) if (assignArm(`viewer-${i}`) === "treatment") treat++;
    const frac = treat / N;
    assert.ok(frac > 0.47 && frac < 0.53, `split ${frac} not ~50/50`);
  });
});

describe("T3 epsilon-greedy propensity", () => {
  const variants: Variant[] = [{ variantId: "slow" }, { variantId: "fast" }];
  const value = { slow: 0.4, fast: 0.9 }; // fast is greedy
  it("epsilon 0 is pure greedy with propensity 1.0", () => {
    const sel = selectTreatment(variants, value, 0, seededRng("x"));
    assert.equal(sel.variantId, "fast");
    assert.equal(sel.propensity, 1.0);
    assert.equal(sel.explored, false);
  });
  it("greedy arm propensity is 1-eps+eps/k, others eps/k, all strictly positive", () => {
    const eps = 0.2, k = 2;
    // force a greedy pick (rng first draw >= eps)
    const greedy = selectTreatment(variants, value, eps, () => 0.99);
    assert.equal(greedy.variantId, "fast");
    assert.ok(Math.abs(greedy.propensity - (1 - eps + eps / k)) < 1e-9);
    // force an explore that lands on the non-greedy arm (first draw < eps, second selects index 0)
    const explore = selectTreatment(variants, value, eps, (() => { let i = 0; return () => (i++ === 0 ? 0.0 : 0.0); })());
    assert.equal(explore.variantId, "slow");
    assert.ok(Math.abs(explore.propensity - eps / k) < 1e-9);
    assert.ok(greedy.propensity > 0 && explore.propensity > 0);
  });
  it("control is deterministic with propensity 1.0", () => {
    const c = controlImpression("slow");
    assert.equal(c.propensity, 1.0);
    assert.equal(c.variantId, "slow");
  });
});

describe("T5 surrogate", () => {
  it("is bounded in [0,1] and monotonic in completion", () => {
    const lo = surrogateReward({ beat_completion: 0, session_continuation: false, next_session_within_24h: false });
    const hi = surrogateReward({ beat_completion: 1, session_continuation: true, next_session_within_24h: true });
    assert.ok(lo >= 0 && hi <= 1 && hi > lo);
    const a = surrogateReward({ beat_completion: 0.2, session_continuation: false, next_session_within_24h: false });
    const b = surrogateReward({ beat_completion: 0.8, session_continuation: false, next_session_within_24h: false });
    assert.ok(b > a);
  });
  it("correlation is 1 for a perfectly increasing pair", () => {
    assert.ok(Math.abs(correlation([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-9);
  });
});

describe("T7 always-valid radius", () => {
  it("is finite and shrinks as n grows", () => {
    assert.ok(Number.isFinite(alwaysValidRadius(100)));
    assert.ok(alwaysValidRadius(10000) < alwaysValidRadius(1000));
    assert.equal(alwaysValidRadius(0), Infinity);
  });
});

describe("T7/T8 end-to-end readout", () => {
  it("declares Gate A GREEN on a planted lift, with treatment D7 above control and no guardrail breach", () => {
    const rows = simulateExperiment({ viewers: 20000, scenario: "lift" });
    const r = gateAReadout(rows);
    assert.ok(r.treatment.d7Return > r.control.d7Return, "treatment D7 should exceed control");
    assert.ok(r.d7.diff >= 0.02, `diff ${r.d7.diff} below threshold`);
    assert.equal(r.d7.verdict, "green");
    assert.equal(r.guardrails.ok, true);
    assert.equal(r.gateA, "green");
  });
  it("does NOT declare green when the arms are flat", () => {
    const rows = simulateExperiment({ viewers: 20000, scenario: "flat" });
    const r = gateAReadout(rows);
    assert.notEqual(r.gateA, "green");
    assert.ok(Math.abs(r.d7.diff) < 0.02, `flat diff ${r.d7.diff} unexpectedly large`);
  });
  it("off-policy SNIPS returns a band (lo <= estimate <= hi) with positive ESS", () => {
    const rows = simulateExperiment({ viewers: 1500, scenario: "lift" });
    const treatment = rows.filter((x) => x.arm === "treatment");
    const band = snipsBand(treatment, greedyCandidateProb, { bootstraps: 100 });
    assert.ok(band.n > 0 && band.ess > 0);
    assert.ok(band.lo <= band.estimate + 1e-9 && band.estimate <= band.hi + 1e-9);
  });
});

describe("T4 propensity logging (the data wall)", () => {
  it("logs every impression with arm, propensity and surrogate; refuses a zero-propensity row", async () => {
    const captured: { text: string; params: unknown[] }[] = [];
    const sql: SqlClient = { async query(text, params) { captured.push({ text, params: params ?? [] }); return { rows: [] }; } };
    const rows = simulateExperiment({ viewers: 50, scenario: "lift" });
    const n = await logImpressions(sql, rows);
    assert.equal(n, rows.length, "every impression must be logged");
    assert.equal(captured.length, rows.length);
    // is_control is the 4th param; propensity 6th; reward jsonb 7th carries session_id + surrogate
    const sample = captured[0].params;
    assert.equal(typeof sample[3], "boolean");
    assert.ok((sample[5] as number) > 0);
    const reward = JSON.parse(sample[6] as string);
    assert.ok(reward.session_id && reward.surrogate && typeof reward.surrogate.beat_completion === "number");
    // a zero/negative propensity is rejected (would break IPS)
    const bad = { ...rows[0], propensity: 0 };
    await assert.rejects(() => logImpressions(sql, [bad]));
  });
  it("impressionParams maps control arm to is_control true", () => {
    const rows = simulateExperiment({ viewers: 200, scenario: "lift" });
    const ctl = rows.find((r) => r.arm === "control")!;
    assert.equal(impressionParams(ctl)[3], true);
  });
});
