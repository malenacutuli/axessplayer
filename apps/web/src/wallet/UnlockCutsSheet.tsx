// 20-V5 PREMIUM-CUT MERCHANDISING: the "Unlock more of this story" bottom sheet. It presents the
// premium cut TYPES as distinct purchasable variants from the CUTS API CONTRACT (GET /series/:id/cuts):
// Alternate ending, His/Her POV, Intensity+, each priced in credits with a clear label. Buying calls the
// EXISTING economy /spend (idempotent, own-once via a stable client_txn_id, useCutPurchase); on success
// the cut is granted (entitlement) and becomes playable. Owned vs locked is read from the wallet
// entitlements. The same sheet is merchandised in the player (as a control) and on series detail.
//
// Events: premium_cut_shown on open, unlock_shown per offered cut row, premium_cut_purchased +
// unlock_purchased + credits_spent on a settled buy. Anti-dark-pattern: transparent pricing shown up
// front, server spend cool-down respected (no auto-retry), no manipulation, never a live Stripe rail.
// Real loading / empty / error states. WCAG 2.2 AA: a labelled modal dialog, keyboard reachable, an
// Escape close, and the owned/locked state announced per row. No em dashes.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, CreditsPill, Skeleton, EmptyState, ErrorState } from "@axessplayer/ui";
import type { EconomyClient } from "../api/economy.js";
import type { CutsClient, BeatCuts, SeriesCut } from "../api/cuts.js";
import { CUT_KIND_COPY } from "../api/cuts.js";
import type { ViewerAnalytics } from "../analytics/analytics.js";
import { useCutPurchase } from "./useCutPurchase.js";
import { LockIcon } from "../ui/icons.js";

export interface UnlockCutsSheetProps {
  seriesId: string;
  cuts: CutsClient;
  economy: EconomyClient;
  analytics: ViewerAnalytics;
  // Where the sheet was opened from, stamped on every event so player vs detail merchandising is
  // distinguishable downstream.
  surface: "player" | "series_detail";
  onClose: () => void;
  // Called with the granted variant id when a cut is unlocked, so the player can make it playable.
  onUnlocked?: (variantId: string) => void;
}

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; beats: BeatCuts[] };

export function UnlockCutsSheet({
  seriesId,
  cuts,
  economy,
  analytics,
  surface,
  onClose,
  onUnlocked,
}: UnlockCutsSheetProps) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const purchase = useCutPurchase(economy);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownRef = useRef(false);

  const fetchCuts = useCallback(() => {
    let live = true;
    setLoad({ status: "loading" });
    void (async () => {
      try {
        const beats = await cuts.getSeriesCuts(seriesId);
        if (live) setLoad({ status: "ready", beats });
      } catch (err) {
        if (live) setLoad({ status: "error", message: err instanceof Error ? err.message : "Could not load cuts" });
      }
    })();
    return () => {
      live = false;
    };
  }, [cuts, seriesId]);

  useEffect(() => fetchCuts(), [fetchCuts]);

  // Move focus to the sheet heading on open (WCAG 2.2 AA focus management), and close on Escape so the
  // viewer is never trapped behind the sheet.
  useEffect(() => {
    headingRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // premium_cut_shown + one unlock_shown per offered cut, once the cuts have loaded.
  useEffect(() => {
    if (load.status !== "ready" || shownRef.current) return;
    shownRef.current = true;
    const allCuts = load.beats.flatMap((b) => b.cuts);
    analytics.track("premium_cut_shown", {
      seriesId,
      props: { surface, cutCount: allCuts.length, kinds: Array.from(new Set(allCuts.map((c) => c.kind))) },
    });
    for (const b of load.beats) {
      for (const c of b.cuts) {
        analytics.track("unlock_shown", {
          seriesId,
          beatId: b.beatId,
          variantId: c.variantId,
          props: { surface, kind: c.kind, coinCost: c.coinCost },
        });
      }
    }
  }, [load, analytics, seriesId, surface]);

  const onBuy = useCallback(
    async (beat: BeatCuts, cut: SeriesCut) => {
      const ok = await purchase.buy(cut.variantId);
      if (ok) {
        // A settled unlock: emit the monetization + economy events, then make it playable.
        analytics.track("premium_cut_purchased", {
          seriesId,
          beatId: beat.beatId,
          variantId: cut.variantId,
          props: { surface, kind: cut.kind, coinCost: cut.coinCost },
        });
        analytics.track("unlock_purchased", {
          seriesId,
          beatId: beat.beatId,
          variantId: cut.variantId,
          props: { surface, kind: cut.kind, coinCost: cut.coinCost },
        });
        analytics.track("credits_spent", {
          seriesId,
          variantId: cut.variantId,
          props: { surface, amount: cut.coinCost, scope: "beat_variant", reason: "premium_cut" },
        });
        onUnlocked?.(cut.variantId);
      }
    },
    [purchase, analytics, seriesId, surface, onUnlocked],
  );

  const balance = purchase.state.balance;

  return (
    <div
      className="sheet up cutsheet"
      role="dialog"
      aria-modal="true"
      aria-label="Unlock more of this story"
      data-testid="unlock-cuts-sheet"
    >
      <div className="cutsheet__head">
        <h3 ref={headingRef} tabIndex={-1}>
          Unlock more of this story
        </h3>
        <button
          type="button"
          className="cutsheet__close"
          onClick={onClose}
          aria-label="Close"
          data-testid="unlock-cuts-close"
        >
          <CloseGlyph />
        </button>
      </div>

      <p className="cutsheet__sub" data-testid="unlock-cuts-balance">
        {balance == null ? "Loading your balance." : `Your balance: ${balance} credits.`} Pricing is shown
        up front. Buying never charges real money in this build.
      </p>

      <div className="cutsheet__body">
        {load.status === "loading" && (
          <div data-testid="unlock-cuts-loading">
            <Skeleton width="100%" height={64} style={{ marginBottom: 10 }} />
            <Skeleton width="100%" height={64} style={{ marginBottom: 10 }} />
            <Skeleton width="100%" height={64} />
          </div>
        )}

        {load.status === "error" && (
          <ErrorState
            title="Could not load cuts"
            action={
              <Button variant="secondary" onClick={fetchCuts}>
                Try again
              </Button>
            }
          >
            {load.message}
          </ErrorState>
        )}

        {load.status === "ready" && load.beats.every((b) => b.cuts.length === 0) && (
          <div data-testid="unlock-cuts-empty">
            <EmptyState title="No extra cuts yet">
              This story has no premium cuts to unlock right now. New endings, points of view, and intensity
              cuts show up here as they are published.
            </EmptyState>
          </div>
        )}

        {load.status === "ready" &&
          load.beats
            .filter((b) => b.cuts.length > 0)
            .map((beat) => (
              <section key={beat.beatId} className="cutsheet__beat" aria-label={beat.beatLabel}>
                <h4 className="cutsheet__beat-label">{beat.beatLabel}</h4>
                <ul className="cutsheet__cuts">
                  {beat.cuts.map((cut) => {
                    const owned = purchase.isOwned(cut.variantId);
                    const rowStatus = purchase.state.status[cut.variantId] ?? "idle";
                    const rowError = purchase.state.error[cut.variantId] ?? null;
                    const busy = rowStatus === "spending";
                    const copy = CUT_KIND_COPY[cut.kind];
                    const canAfford = balance == null || balance >= cut.coinCost;
                    return (
                      <li
                        key={cut.variantId}
                        className="cutsheet__cut"
                        data-testid={`cut-${cut.variantId}`}
                        data-kind={cut.kind}
                        data-owned={owned ? "true" : "false"}
                      >
                        <div className="cutsheet__cut-info">
                          <div className="cutsheet__cut-title">
                            <span className="cutsheet__cut-kind" data-kind={cut.kind}>
                              {copy.title}
                            </span>
                            <span className="cutsheet__cut-label">{cut.label}</span>
                          </div>
                          <p className="cutsheet__cut-blurb">{copy.blurb}</p>
                          {rowStatus === "error" && rowError && (
                            <p role="alert" className="cutsheet__cut-err" data-testid={`cut-error-${cut.variantId}`}>
                              {rowError}
                            </p>
                          )}
                          {rowStatus === "paywalled" && (
                            <p role="alert" className="cutsheet__cut-err" data-testid={`cut-paywall-${cut.variantId}`}>
                              Not enough credits. Top up in your wallet to unlock this cut.
                            </p>
                          )}
                        </div>
                        <div className="cutsheet__cut-action">
                          {owned ? (
                            <span className="cutsheet__owned" data-testid={`cut-owned-${cut.variantId}`}>
                              <CheckGlyph /> Owned
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="cutsheet__buy"
                              onClick={() => void onBuy(beat, cut)}
                              disabled={busy || !canAfford}
                              data-testid={`cut-buy-${cut.variantId}`}
                              aria-label={`Unlock ${copy.title}, ${cut.label}, for ${cut.coinCost} credits`}
                            >
                              <LockIcon stroke="currentColor" />
                              {busy ? "Unlocking..." : <CreditsPill amount={cut.coinCost} />}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
      </div>
    </div>
  );
}

function CloseGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
