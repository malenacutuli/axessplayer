// Spec-derived tests for the licensing plane: tenant lifecycle is idempotent, API keys are hash-only with
// revocation, metering is idempotent and cap-enforced, and billing is a correct REPORT (base + overage),
// never a charge. No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { provision, suspend, reactivate, isOperational } from "./tenant.js";
import { issueApiKey, verifyApiKey, revoke, hashApiKey } from "./apiKeys.js";
import { quotaCheck, recordUsage, remaining, overageCredits, type MeteredTenant } from "./metering.js";
import { invoice, PLAN_BASE_USD } from "./billing.js";

describe("P12 tenant lifecycle", () => {
  it("provisions active and suspends/reactivates idempotently", () => {
    const t = provision("t1", "Acme", "standard");
    assert.equal(isOperational(t), true);
    const s = suspend(t);
    assert.equal(s.status, "suspended");
    assert.equal(suspend(s), s); // idempotent
    assert.equal(isOperational(reactivate(s)), true);
    assert.throws(() => provision("", "x", "trial"));
  });
});

describe("P12 engine-API keys", () => {
  const RAW = "axp_live_3kZ9_secret_material";
  it("stores only a hash and verifies a presented key to its tenant", () => {
    const rec = issueApiKey("k1", "t1", RAW);
    assert.equal(rec.hash, hashApiKey(RAW));
    assert.notEqual(rec.hash, RAW); // never the raw key
    assert.equal(rec.prefix.length, 12);
    assert.equal(verifyApiKey(RAW, [rec]), "t1");
    assert.equal(verifyApiKey("wrong-key-aaaaaa", [rec]), null);
  });
  it("a revoked key no longer verifies (idempotent revoke)", () => {
    const rec = revoke(issueApiKey("k2", "t1", RAW));
    assert.equal(rec.revoked, true);
    assert.equal(verifyApiKey(RAW, [rec]), null);
    assert.equal(revoke(rec), rec);
  });
  it("refuses to issue from a too-short key", () => {
    assert.throws(() => issueApiKey("k3", "t1", "short"));
  });
});

describe("P12 metering (idempotent, cap-enforced)", () => {
  const base: MeteredTenant = { tenantId: "t1", includedCredits: 100, usedCredits: 0, hardCap: 120 };
  it("records usage idempotently by key and reflects remaining", () => {
    const seen = new Set<string>();
    const r1 = recordUsage(base, 30, "evt-1", seen);
    assert.equal(r1.charged, 30);
    assert.equal(remaining(r1.tenant), 90);
    const r2 = recordUsage(r1.tenant, 30, "evt-1", seen); // replay
    assert.equal(r2.duplicate, true);
    assert.equal(r2.charged, 0);
  });
  it("denies a call that would exceed the hard cap", () => {
    const near: MeteredTenant = { ...base, usedCredits: 115 };
    assert.equal(quotaCheck(near, 10).allowed, false);
    assert.equal(quotaCheck(near, 5).allowed, true);
    assert.throws(() => recordUsage(near, 10, "evt-x", new Set()));
  });
  it("computes overage above the included credits", () => {
    assert.equal(overageCredits({ ...base, usedCredits: 110 }), 10);
    assert.equal(overageCredits({ ...base, usedCredits: 80 }), 0);
  });
});

describe("P12 billing report (report, not a charge)", () => {
  it("bills the plan base plus metered overage", () => {
    const t: MeteredTenant = { tenantId: "t1", includedCredits: 100, usedCredits: 130, hardCap: 200 };
    const inv = invoice(t, "standard", { overageRate: 0.02 });
    assert.equal(inv.baseUsd, PLAN_BASE_USD.standard);
    assert.equal(inv.overageCredits, 30);
    assert.equal(inv.overageUsd, 0.6);
    assert.equal(inv.totalUsd, PLAN_BASE_USD.standard + 0.6);
  });
  it("a trial within included credits owes nothing", () => {
    const inv = invoice({ tenantId: "t2", includedCredits: 50, usedCredits: 20, hardCap: 50 }, "trial");
    assert.equal(inv.totalUsd, 0);
  });
});
