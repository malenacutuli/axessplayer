// The premium-cut purchase hook (20-V5). It settles a cut unlock against the EXISTING economy /spend
// with a STABLE client_txn_id per (beat_variant, variantId) so a double-click or retry is an idempotent
// server-side no-op (own-once). Ownership is read from the economy /wallet entitlements
// ([{scope:'beat_variant', scope_id}]); the balance and the granted entitlement are reconciled from the
// server response (never computed client-side as truth). A 402 surfaces the contract PaywallOptions so
// the sheet can route the viewer to top up. Anti-dark-pattern: the spend cool-down the server enforces
// is respected (we never auto-retry around a cool-down). No em dashes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PaywallError,
  type EconomyClient,
  type PaywallOptions,
} from "../api/economy.js";

export type CutPurchaseStatus = "idle" | "spending" | "error" | "paywalled";

export interface CutPurchaseState {
  // Spendable balance, reconciled from the server (null until the wallet has loaded).
  balance: number | null;
  // The set of owned beat_variant scope ids (from the wallet entitlements + any just-granted unlock).
  owned: Set<string>;
  // Per-variant in-flight / error status, so each row reflects its own state independently.
  status: Record<string, CutPurchaseStatus>;
  error: Record<string, string | null>;
  // The server PaywallOptions from the most recent 402, if any (insufficient funds -> top up).
  paywall: PaywallOptions | null;
  loading: boolean;
}

export interface UseCutPurchase {
  state: CutPurchaseState;
  // Settle a cut unlock. Idempotent per variant for this hook instance. Resolves true on a granted /
  // already-owned unlock, false on a paywall (insufficient funds) or error.
  buy: (variantId: string) => Promise<boolean>;
  // Re-read the wallet (balance + entitlements) from the server.
  refresh: () => Promise<void>;
  isOwned: (variantId: string) => boolean;
}

function newTxnId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `txn_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function useCutPurchase(economy: EconomyClient): UseCutPurchase {
  const [balance, setBalance] = useState<number | null>(null);
  const [owned, setOwned] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<Record<string, CutPurchaseStatus>>({});
  const [error, setError] = useState<Record<string, string | null>>({});
  const [paywall, setPaywall] = useState<PaywallOptions | null>(null);
  const [loading, setLoading] = useState(true);

  // One stable txn id per variant for this hook instance, so retries are idempotent on the server.
  const txnIds = useRef<Map<string, string>>(new Map());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const wallet = await economy.getWallet();
      setBalance(wallet.balance);
      setOwned((prev) => {
        const next = new Set(prev);
        for (const e of wallet.entitlements ?? []) {
          if (e.scope === "beat_variant") next.add(e.scope_id);
        }
        return next;
      });
    } catch {
      // Best-effort: a wallet read failure leaves the last known balance/ownership; rows stay locked
      // rather than the sheet dead-ending.
    } finally {
      setLoading(false);
    }
  }, [economy]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const buy = useCallback(
    async (variantId: string): Promise<boolean> => {
      // Already owned (own-once): a no-op, never a second debit.
      if (owned.has(variantId)) return true;

      let txn = txnIds.current.get(variantId);
      if (!txn) {
        txn = newTxnId();
        txnIds.current.set(variantId, txn);
      }

      setStatus((s) => ({ ...s, [variantId]: "spending" }));
      setError((e) => ({ ...e, [variantId]: null }));
      setPaywall(null);
      try {
        const res = await economy.spend({
          scope: "beat_variant",
          scope_id: variantId,
          client_txn_id: txn,
        });
        // Reconcile from the server: the balance and entitlement are authoritative.
        setBalance(res.balance);
        setOwned((prev) => {
          const next = new Set(prev);
          next.add(res.entitlement?.scope_id ?? variantId);
          return next;
        });
        setStatus((s) => ({ ...s, [variantId]: "idle" }));
        return true;
      } catch (err) {
        if (err instanceof PaywallError) {
          setPaywall(err.options);
          setStatus((s) => ({ ...s, [variantId]: "paywalled" }));
          return false;
        }
        setStatus((s) => ({ ...s, [variantId]: "error" }));
        setError((e) => ({
          ...e,
          [variantId]: err instanceof Error ? err.message : "purchase failed",
        }));
        return false;
      }
    },
    [economy, owned],
  );

  const isOwned = useCallback((variantId: string) => owned.has(variantId), [owned]);

  const state = useMemo<CutPurchaseState>(
    () => ({ balance, owned, status, error, paywall, loading }),
    [balance, owned, status, error, paywall, loading],
  );

  return { state, buy, refresh, isOwned };
}
