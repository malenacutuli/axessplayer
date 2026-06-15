// Wallet + paywall logic (no rendering). The screen shows the balance and entitlements from GET /wallet,
// and at a premium beat presents the paywall (buy / watch ad / subscribe) and calls POST /spend. The
// server is authoritative for balances and entitlements: this layer NEVER computes either as truth. It
// does keep an OPTIMISTIC view for snappy UI and then RECONCILES against the server result, exactly as
// the W6 brief requires (optimistic UI then reconcile). No em dashes.
//
// F1: spend bodies carry scope, scope_id, client_txn_id only. The api client both types this (codegen)
// and runtime-guards it (assertNoForbiddenKeys); this layer never adds identity.

import {
  PaywallRequiredError,
  type ApiClient,
} from "../api/client.js";
import type {
  Entitlement,
  PaywallOptions,
  SpendResult,
  Wallet,
} from "../api/types.js";

// Is the session subject entitled to this scope already? Read off the wallet the SERVER returned, never
// inferred locally. Used to decide whether a beat/episode plays straight through or hits the paywall.
export function hasEntitlement(
  wallet: Wallet,
  scope: Entitlement["scope"],
  scopeId: string
): boolean {
  return wallet.entitlements.some(
    (e) => e.scope === scope && e.scope_id === scopeId
  );
}

// Total spendable coins as the server reported them (balance + bonus). Display + affordability HINT only;
// the real affordability verdict is the server's (a 402 vs a 200 on /spend), never this sum.
export function spendableCoins(wallet: Wallet): number {
  return wallet.balance + wallet.bonus_balance;
}

// The outcome of an unlock attempt, for the screen to render.
export type UnlockOutcome =
  | { kind: "unlocked"; balance: number; entitlement: Entitlement }
  | { kind: "paywall"; options: PaywallOptions["options"] }
  | { kind: "auth_required" };

// A monotonic-ish client transaction id for /spend idempotency. The server is idempotent on this id, so
// a retried tap does not double-charge. Real app uses a uuid; this is dependency-free and unique enough.
export function newClientTxnId(prefix = "spend"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Attempt to unlock a scope. Returns the outcome; does NOT mutate any wallet itself (the caller applies
// reconcileAfterSpend on success). A 402 surfaces the contract PaywallOptions for the buy/ad/subscribe
// presentation; a 401 surfaces auth_required so the host routes to sign-in.
export async function unlock(
  client: ApiClient,
  scope: Entitlement["scope"],
  scopeId: string,
  clientTxnId = newClientTxnId()
): Promise<UnlockOutcome> {
  try {
    const result = await client.spend({ scope, scope_id: scopeId, client_txn_id: clientTxnId });
    return { kind: "unlocked", balance: result.balance, entitlement: result.entitlement };
  } catch (err) {
    if (err instanceof PaywallRequiredError) {
      return { kind: "paywall", options: err.options.options };
    }
    // AuthRequiredError carries status 401; rethrow anything else (network, 5xx) for the host to handle.
    if (isStatus(err, 401)) return { kind: "auth_required" };
    throw err;
  }
}

// Reconcile the local wallet view with the SERVER result of a successful spend: adopt the server balance
// and append the granted entitlement. This is the "then reconcile" half of optimistic UI: even if the UI
// optimistically marked the scope unlocked, the truth applied here comes from the server. Pure: returns a
// new Wallet, does not mutate.
export function reconcileAfterSpend(wallet: Wallet, result: SpendResult): Wallet {
  const already = hasEntitlement(wallet, result.entitlement.scope, result.entitlement.scope_id);
  return {
    ...wallet,
    balance: result.balance,
    entitlements: already
      ? wallet.entitlements
      : [...wallet.entitlements, result.entitlement],
  };
}

// The optimistic view to show the instant the viewer taps unlock, BEFORE the server replies: mark the
// scope entitled and (if affordable from the displayed balance) decrement the displayed balance. Purely
// presentational and ALWAYS overwritten by reconcileAfterSpend (or rolled back on a 402/error). Never
// treated as truth. Pure: returns a new Wallet.
export function optimisticUnlock(
  wallet: Wallet,
  scope: Entitlement["scope"],
  scopeId: string,
  estimatedCost: number
): Wallet {
  if (hasEntitlement(wallet, scope, scopeId)) return wallet;
  const fromBalance = Math.min(estimatedCost, wallet.balance);
  const fromBonus = Math.min(estimatedCost - fromBalance, wallet.bonus_balance);
  return {
    ...wallet,
    balance: wallet.balance - fromBalance,
    bonus_balance: wallet.bonus_balance - fromBonus,
    entitlements: [...wallet.entitlements, { scope, scope_id: scopeId }],
  };
}

function isStatus(err: unknown, status: number): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === status
  );
}
