// Spec-derived tests for the admin/operator console core: policy alerts fire on the right conditions,
// moderation is first-decision-wins (idempotent, human-in-the-loop), and payouts are a correct REPORT with
// the platform fee, not a disbursement. No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { policyAlerts, type SeriesReadout } from "./alerts.js";
import { decide, pendingQueue, counts, type ModerationItem } from "./moderation.js";
import { payoutReport, allPayoutReports, PLATFORM_FEE_RATE } from "./payouts.js";

describe("P9 policy alerts", () => {
  it("raises a critical alert on a guardrail breach", () => {
    const r: SeriesReadout = { seriesId: "s1", gateA: "green", guardrailsOk: false, d7Diff: 0.05, viewers: 1000 };
    const a = policyAlerts([r]);
    assert.equal(a.length, 1);
    assert.equal(a[0].severity, "critical");
  });
  it("warns when the adaptive cut underperforms the fixed cut", () => {
    const r: SeriesReadout = { seriesId: "s2", gateA: "flat_or_negative", guardrailsOk: true, d7Diff: -0.03, viewers: 1000 };
    assert.equal(policyAlerts([r])[0].severity, "warn");
  });
  it("flags inconclusive-at-scale and stays quiet on a healthy green series", () => {
    const big: SeriesReadout = { seriesId: "s3", gateA: "inconclusive", guardrailsOk: true, d7Diff: 0.001, viewers: 80000 };
    assert.equal(policyAlerts([big])[0].severity, "info");
    const green: SeriesReadout = { seriesId: "s4", gateA: "green", guardrailsOk: true, d7Diff: 0.06, viewers: 80000 };
    assert.equal(policyAlerts([green]).length, 0);
  });
});

describe("P9 moderation queue", () => {
  const item = (over: Partial<ModerationItem> = {}): ModerationItem => ({ id: "m1", subjectId: "v1", kind: "user_report", state: "pending", createdAt: "2026-06-17T00:00:00Z", ...over });
  it("first decision wins; a re-decision is an idempotent no-op", () => {
    const approved = decide(item(), { decision: "approved", reviewer: "op1", reason: "ok", at: "2026-06-17T01:00:00Z" });
    assert.equal(approved.state, "approved");
    assert.equal(approved.reviewer, "op1");
    const reflip = decide(approved, { decision: "rejected", reviewer: "op2", at: "2026-06-17T02:00:00Z" });
    assert.deepEqual(reflip, approved); // unchanged, original ruling and reviewer preserved
  });
  it("requires a reviewer and surfaces the pending queue oldest-first", () => {
    assert.throws(() => decide(item(), { decision: "approved", reviewer: "", at: "t" }), /reviewer/);
    const q = pendingQueue([item({ id: "b", createdAt: "2026-06-17T02:00:00Z" }), item({ id: "a", createdAt: "2026-06-17T01:00:00Z" })]);
    assert.deepEqual(q.map((i) => i.id), ["a", "b"]);
    assert.deepEqual(counts([item(), item({ id: "m2", state: "approved" })]), { pending: 1, approved: 1, rejected: 0 });
  });
});

describe("P9 payout report (report, not disbursement)", () => {
  it("computes gross, platform fee, and net from attributed spends", () => {
    const spends = [
      { creatorId: "c1", coins: 100 },
      { creatorId: "c1", coins: 50 },
      { creatorId: "c2", coins: 30 },
    ];
    const r = payoutReport("c1", spends, { usdPerCoin: 0.1, feeRate: 0.3 });
    assert.equal(r.grossCoins, 150);
    assert.equal(r.grossUsd, 15);
    assert.equal(r.platformFeeUsd, 4.5);
    assert.equal(r.netUsd, 10.5);
  });
  it("ranks creators by net and uses the flagged default fee", () => {
    const all = allPayoutReports([{ creatorId: "c1", coins: 200 }, { creatorId: "c2", coins: 10 }]);
    assert.deepEqual(all.map((r) => r.creatorId), ["c1", "c2"]);
    assert.ok(PLATFORM_FEE_RATE > 0 && PLATFORM_FEE_RATE < 1);
  });
});
