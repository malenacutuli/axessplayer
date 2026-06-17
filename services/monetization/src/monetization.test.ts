// Spec-derived tests for the monetization logic. Property focus on the money invariants: idempotency keys
// are stable and unique per economic event, a client cannot mint coins (server produces grants from
// verified events only), unpaid/livemode Stripe sessions never grant, and the paywall bandit logs an
// honest propensity. None of this transacts; the /grant call is fenced behind the money sign-off.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectOffer, DEFAULT_OFFERS } from "./paywall.js";
import { settleCheckin, settleRewardedAd, checkinTxnId, REWARD_AMOUNTS } from "./rewards.js";
import { grantFromCheckout, type CheckoutSession } from "./stripe.js";
import { isGrant } from "./grant.js";

describe("P6-T3 paywall bandit", () => {
  const conv = { pack_small: 0.2, pack_medium: 0.5, pack_large: 0.1 };
  it("greedy picks the highest-conversion offer with propensity 1-eps+eps/k", () => {
    const sel = selectOffer(DEFAULT_OFFERS, conv, 0.3, () => 0.99); // no explore
    assert.equal(sel.offerId, "pack_medium");
    assert.ok(Math.abs(sel.propensity - (1 - 0.3 + 0.3 / 3)) < 1e-9);
    assert.equal(sel.explored, false);
  });
  it("a forced explore surfaces another offer with eps/k propensity", () => {
    let i = 0;
    const sel = selectOffer(DEFAULT_OFFERS, conv, 0.3, () => (i++ === 0 ? 0.0 : 0.0)); // explore, index 0 -> pack_small
    assert.equal(sel.offerId, "pack_small");
    assert.ok(Math.abs(sel.propensity - 0.3 / 3) < 1e-9);
    assert.equal(sel.explored, true);
  });
  it("epsilon 0 is pure greedy, propensity excludes zero for IPS", () => {
    const sel = selectOffer(DEFAULT_OFFERS, conv, 0, () => 0.5);
    assert.equal(sel.propensity, 1);
  });
});

describe("P6-T2 reward settlement (idempotent, server-minted)", () => {
  it("daily check-in is once per user per UTC day (stable idempotency key)", () => {
    const g1 = settleCheckin("u1", "2026-06-17");
    const g2 = settleCheckin("u1", "2026-06-17");
    assert.equal(g1.clientTxnId, g2.clientTxnId); // ledger dedupes the second
    assert.equal(g1.clientTxnId, checkinTxnId("u1", "2026-06-17"));
    assert.equal(g1.amount, REWARD_AMOUNTS.checkin);
    assert.notEqual(settleCheckin("u1", "2026-06-18").clientTxnId, g1.clientTxnId);
  });
  it("a rewarded ad grants only when network-verified, keyed by impression id", () => {
    const ok = settleRewardedAd({ userId: "u1", impressionId: "imp-9", verified: true });
    assert.ok(isGrant(ok));
    if (isGrant(ok)) {
      assert.equal(ok.clientTxnId, "ad:imp-9");
      assert.equal(ok.type, "rewarded_ad");
    }
    assert.ok(!isGrant(settleRewardedAd({ userId: "u1", impressionId: "imp-9", verified: false })));
    assert.ok(!isGrant(settleRewardedAd({ userId: "u1", impressionId: "", verified: true })));
  });
});

describe("P6-T4 Stripe checkout to grant", () => {
  const base: CheckoutSession = { id: "cs_test_1", payment_status: "paid", livemode: false, metadata: { userId: "u1", offerId: "pack_medium" } };
  it("grants the offer's coins on a paid test session, idempotent on the session id", () => {
    const g = grantFromCheckout(base, DEFAULT_OFFERS);
    assert.ok(isGrant(g));
    if (isGrant(g)) {
      assert.equal(g.amount, 120);
      assert.equal(g.type, "iap");
      assert.equal(g.clientTxnId, "stripe:cs_test_1");
    }
  });
  it("never grants on an unpaid session", () => {
    assert.ok(!isGrant(grantFromCheckout({ ...base, payment_status: "unpaid" }, DEFAULT_OFFERS)));
  });
  it("blocks a livemode session until the money sign-off (test mode only)", () => {
    assert.ok(!isGrant(grantFromCheckout({ ...base, livemode: true }, DEFAULT_OFFERS)));
    assert.ok(isGrant(grantFromCheckout({ ...base, livemode: true }, DEFAULT_OFFERS, { allowLive: true })));
  });
  it("refuses an unknown offer or missing metadata (coins never come from client input)", () => {
    assert.ok(!isGrant(grantFromCheckout({ ...base, metadata: { userId: "u1", offerId: "nope" } }, DEFAULT_OFFERS)));
    assert.ok(!isGrant(grantFromCheckout({ ...base, metadata: {} }, DEFAULT_OFFERS)));
  });
});
