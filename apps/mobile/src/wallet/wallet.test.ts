// Wallet + paywall logic tests: entitlement checks read the server wallet (never local truth), unlock
// maps 200/402/401 to the right outcome, optimistic UI then reconcile lands on the server balance, and a
// premium beat gates only when not already entitled. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { PaywallRequiredError, AuthRequiredError } from "../api/client.js";
import {
  hasEntitlement,
  optimisticUnlock,
  reconcileAfterSpend,
  spendableCoins,
  unlock,
} from "./wallet.js";
import { paywallGateForBeat } from "../player/controller.js";
import type { BeatNode } from "../feed/graph.js";
import { PREMIUM_VARIANT, fakeClient, sampleWallet } from "../test-support/fixtures.js";

test("spendableCoins sums balance and bonus from the server wallet", () => {
  assert.equal(spendableCoins(sampleWallet({ balance: 100, bonus_balance: 20 })), 120);
});

test("hasEntitlement reads the server wallet, not a local inference", () => {
  const w = sampleWallet({ entitlements: [{ scope: "episode", scope_id: "ep-1" }] });
  assert.equal(hasEntitlement(w, "episode", "ep-1"), true);
  assert.equal(hasEntitlement(w, "episode", "ep-2"), false);
});

test("unlock maps a 200 spend to an unlocked outcome with the server balance + entitlement", async () => {
  const outcome = await unlock(fakeClient(), "beat_variant", PREMIUM_VARIANT, "txn-1");
  assert.equal(outcome.kind, "unlocked");
  if (outcome.kind === "unlocked") {
    assert.equal(outcome.balance, 50);
    assert.equal(outcome.entitlement.scope_id, PREMIUM_VARIANT);
  }
});

test("unlock maps a 402 to a paywall outcome carrying the server option set", async () => {
  const client = fakeClient({
    spend: async () => {
      throw new PaywallRequiredError({ error: "insufficient_funds", options: ["buy", "subscribe"] });
    },
  });
  const outcome = await unlock(client, "beat_variant", PREMIUM_VARIANT);
  assert.equal(outcome.kind, "paywall");
  if (outcome.kind === "paywall") assert.deepEqual(outcome.options, ["buy", "subscribe"]);
});

test("unlock maps a 401 to auth_required", async () => {
  const client = fakeClient({
    spend: async () => {
      throw new AuthRequiredError();
    },
  });
  const outcome = await unlock(client, "beat_variant", PREMIUM_VARIANT);
  assert.equal(outcome.kind, "auth_required");
});

test("optimistic then reconcile lands on the SERVER balance, not the optimistic estimate", () => {
  const w = sampleWallet({ balance: 100, bonus_balance: 0 });
  const optimistic = optimisticUnlock(w, "beat_variant", PREMIUM_VARIANT, 50);
  // Optimistically debited 50 and marked entitled.
  assert.equal(optimistic.balance, 50);
  assert.equal(hasEntitlement(optimistic, "beat_variant", PREMIUM_VARIANT), true);
  // The server is authoritative: reconcile to whatever it returned (here 50), no double count.
  const reconciled = reconcileAfterSpend(optimistic, {
    balance: 50,
    entitlement: { scope: "beat_variant", scope_id: PREMIUM_VARIANT },
  });
  assert.equal(reconciled.balance, 50);
  assert.equal(
    reconciled.entitlements.filter((e) => e.scope_id === PREMIUM_VARIANT).length,
    1
  );
});

test("paywallGateForBeat gates a premium beat only when not already entitled", () => {
  const beat: BeatNode = {
    id: "b",
    variants: [{ id: PREMIUM_VARIANT, isPremium: true, coinCost: 50 }],
  };
  assert.deepEqual(paywallGateForBeat(beat, sampleWallet()), {
    scope: "beat_variant",
    scopeId: PREMIUM_VARIANT,
    estimatedCost: 50,
  });
  const entitled = sampleWallet({
    entitlements: [{ scope: "beat_variant", scope_id: PREMIUM_VARIANT }],
  });
  assert.equal(paywallGateForBeat(beat, entitled), null);
});

test("paywallGateForBeat returns null for a non-premium beat", () => {
  const beat: BeatNode = { id: "b", variants: [{ id: "free", isPremium: false }] };
  assert.equal(paywallGateForBeat(beat, sampleWallet()), null);
});
