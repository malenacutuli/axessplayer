// The unlock flow. Settles a premium unlock against the economy contract: it calls /spend with a
// stable client_txn_id (idempotent: a retry with the same id is a server-side no-op), reflects the
// 402 PaywallOptions when the viewer cannot afford it, and reconciles the balance from the server
// response (never computed client-side as truth). The body carries scope, scope_id, client_txn_id
// and NEVER a user_id (F1). No em dashes.

import { useCallback, useRef, useState } from "react";
import {
  PaywallError,
  type EconomyClient,
  type Entitlement,
  type PaywallOptions,
} from "../api/economy.js";

export type UnlockStatus = "idle" | "spending" | "unlocked" | "paywalled" | "error";

export interface UnlockState {
  status: UnlockStatus;
  balance: number | null;
  entitlement: Entitlement | null;
  paywall: PaywallOptions | null;
  error: string | null;
}

export interface UseUnlock {
  state: UnlockState;
  // Attempt to unlock a scope. The client_txn_id is stable per (scope, scope_id) for this hook
  // instance so a double-click or retry is idempotent on the server.
  unlock: (scope: "episode" | "beat_variant", scopeId: string) => Promise<void>;
  reset: () => void;
}

function newTxnId(): string {
  // A unique, stable-per-attempt transaction id. crypto.randomUUID is available in browsers and Node 20+.
  try {
    return crypto.randomUUID();
  } catch {
    return `txn_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function useUnlock(economy: EconomyClient): UseUnlock {
  const [state, setState] = useState<UnlockState>({
    status: "idle",
    balance: null,
    entitlement: null,
    paywall: null,
    error: null,
  });

  // One stable txn id per (scope, scope_id) for this hook instance, so retries are idempotent.
  const txnIds = useRef<Map<string, string>>(new Map());

  const unlock = useCallback(
    async (scope: "episode" | "beat_variant", scopeId: string) => {
      const key = `${scope}:${scopeId}`;
      let txn = txnIds.current.get(key);
      if (!txn) {
        txn = newTxnId();
        txnIds.current.set(key, txn);
      }

      setState((s) => ({ ...s, status: "spending", error: null, paywall: null }));
      try {
        const res = await economy.spend({ scope, scope_id: scopeId, client_txn_id: txn });
        // Reconcile from the server: the balance and entitlement are authoritative.
        setState({
          status: "unlocked",
          balance: res.balance,
          entitlement: res.entitlement,
          paywall: null,
          error: null,
        });
      } catch (err) {
        if (err instanceof PaywallError) {
          setState((s) => ({ ...s, status: "paywalled", paywall: err.options }));
          return;
        }
        setState((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : "unlock failed",
        }));
      }
    },
    [economy],
  );

  const reset = useCallback(
    () =>
      setState({
        status: "idle",
        balance: null,
        entitlement: null,
        paywall: null,
        error: null,
      }),
    [],
  );

  return { state, unlock, reset };
}
