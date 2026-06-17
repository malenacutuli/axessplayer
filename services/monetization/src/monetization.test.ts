// Spec-derived tests for the monetization logic. Property focus on the money invariants: idempotency keys
// are stable and unique per economic event, a client cannot mint coins (server produces grants from
// verified events only), unpaid/livemode Stripe sessions never grant, and the paywall bandit logs an
// honest propensity. None of this transacts; the /grant call is fenced behind the money sign-off.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  selectOffer,
  DEFAULT_OFFERS,
  selectPaywallPath,
  PAYWALL_PATHS,
  PATH_REWARD_WEIGHTS,
  REVENUE_OPTIMIZATION_ENABLED,
  REWARD_WEIGHTS_SIGNED_OFF,
  withinSpendCooldown,
  SPEND_COOLDOWN_MS,
  SUBSCRIPTION_TIERS,
} from "./paywall.js";
import { settleCheckin, settleRewardedAd, checkinTxnId, REWARD_AMOUNTS } from "./rewards.js";
import { grantFromCheckout, type CheckoutSession } from "./stripe.js";
import { isGrant } from "./grant.js";

describe("paywall PATH bandit hard rules (GOLD_STANDARD_04)", () => {
  it("revenue extraction is NEVER the objective: revenueOptimized is permanently false, signed off or not", () => {
    assert.equal(REVENUE_OPTIMIZATION_ENABLED, false);
    // Even handed a revenue-skewed weight map, the selection never reports revenue optimization.
    const skewed = { watch_ad: 0, buy: 100, subscribe: 50 };
    for (const r of [0, 0.34, 0.67, 0.99]) {
      const sel = selectPaywallPath(PAYWALL_PATHS, skewed, 0.2, () => r);
      assert.equal(sel.revenueOptimized, false);
      assert.ok(sel.propensity > 0); // strictly positive for IPS
      assert.ok(PAYWALL_PATHS.includes(sel.path));
    }
  });
  it("with neutral production reward weights, the pro-viewer watch_ad path is featured (no explore)", () => {
    // rng above epsilon -> greedy; neutral weights -> greedy is the first path, watch_ad.
    const sel = selectPaywallPath(PAYWALL_PATHS, PATH_REWARD_WEIGHTS, 0.2, () => 0.99);
    assert.equal(sel.path, "watch_ad");
    assert.equal(sel.optimized, REWARD_WEIGHTS_SIGNED_OFF); // optimizing on the reward post sign-off
    assert.equal(sel.revenueOptimized, false);
  });
  it("watch_ad leads the default path order, and reward weights are non-revenue (neutral)", () => {
    assert.equal(PAYWALL_PATHS[0], "watch_ad");
    assert.equal(PATH_REWARD_WEIGHTS.watch_ad, PATH_REWARD_WEIGHTS.buy); // neutral, never price-derived
    assert.equal(PATH_REWARD_WEIGHTS.buy, PATH_REWARD_WEIGHTS.subscribe);
  });
  it("anti-dark-pattern spend cool-down is enforced as a hard window", () => {
    assert.equal(withinSpendCooldown(null, 1000), false);
    assert.equal(withinSpendCooldown(1000, 1000 + SPEND_COOLDOWN_MS - 1), true);
    assert.equal(withinSpendCooldown(1000, 1000 + SPEND_COOLDOWN_MS), false);
  });
  it("subscription tiers carry transparent prices", () => {
    assert.ok(SUBSCRIPTION_TIERS.length >= 2);
    for (const t of SUBSCRIPTION_TIERS) assert.ok(t.priceUsd > 0 && t.coinsPerMonth > 0);
  });
});

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
