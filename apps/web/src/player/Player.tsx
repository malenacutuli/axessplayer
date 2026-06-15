// The adaptive player screen. It plays the chosen cut, advances through the graph via the SDK (decide
// -> prefetch -> seamless switch, no menu), surfaces the accessibility controls, and at a premium beat
// presents the paywall and settles the unlock via /spend. The video surface is a placeholder element
// here: the real hls.js + MSE media stack is W5's on-hardware phase behind the transport and is
// flagged as integration-time. No em dashes.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EconomyClient } from "../api/economy.js";
import type { SeriesGraph, VariantNode } from "../api/content.js";
import { variantForBeat } from "../api/content.js";
import type { Transport } from "@axessplayer/player-sdk";
import { usePlayer } from "./usePlayer.js";
import { A11yControls } from "../a11y/A11yControls.js";
import {
  loadA11yPreferences,
  resolveA11y,
  saveA11yPreferences,
  type A11yPreferences,
} from "../a11y/preferences.js";
import { Paywall, type PaywallChoice } from "../wallet/Paywall.js";
import { useUnlock } from "../wallet/useUnlock.js";

export interface PlayerProps {
  graph: SeriesGraph;
  transport: Transport;
  economy: EconomyClient;
  userId: string;
  startBeatId: string;
  // Called when an unlock changes the balance so the surrounding shell can refresh the wallet.
  onBalanceChange?: (balance: number) => void;
}

export function Player({
  graph,
  transport,
  economy,
  userId,
  startBeatId,
  onBalanceChange,
}: PlayerProps) {
  const { state, advance } = usePlayer({ transport, userId, startBeatId });
  const unlock = useUnlock(economy);

  const [prefs, setPrefs] = useState<A11yPreferences>(() => loadA11yPreferences());
  const onPrefsChange = useCallback((next: A11yPreferences) => {
    setPrefs(next);
    saveA11yPreferences(next);
  }, []);

  // The cut currently on screen: resolve the variant for the current beat/variant id.
  const current: VariantNode | undefined = useMemo(() => {
    return (
      graph.variants.find((v) => v.id === state.currentVariantId) ??
      variantForBeat(graph, state.currentVariantId)
    );
  }, [graph, state.currentVariantId]);

  const active = resolveA11y(prefs, current?.accessibility);
  const availableLanguages = current?.accessibility?.languages ?? [current?.language ?? prefs.language];

  // A premium cut at the current beat that the viewer has not unlocked gates playback behind the paywall.
  const premiumGate: VariantNode | undefined = useMemo(() => {
    if (!current) return undefined;
    return graph.variants.find(
      (v) => v.beat_id === current.beat_id && v.is_premium,
    );
  }, [graph, current]);

  const [showPaywall, setShowPaywall] = useState(false);

  useEffect(() => {
    if (premiumGate && unlock.state.status !== "unlocked") setShowPaywall(true);
  }, [premiumGate, unlock.state.status]);

  useEffect(() => {
    if (unlock.state.status === "unlocked" && unlock.state.balance != null) {
      onBalanceChange?.(unlock.state.balance);
      setShowPaywall(false);
    }
  }, [unlock.state.status, unlock.state.balance, onBalanceChange]);

  const onPaywallChoose = useCallback(
    (choice: PaywallChoice) => {
      if (!premiumGate) return;
      if (choice === "unlock" || choice === "buy") {
        // buy and unlock both settle against /spend here. A real buy first tops up via the IAP / Stripe
        // rail (server-to-server /grant), which is flagged as integration-time. After top up the same
        // /spend settles the unlock.
        void unlock.unlock("beat_variant", premiumGate.id);
      }
      // watch_ad and subscribe route to the ad / subscription rails (server-verified /grant), flagged
      // as integration-time. They are presented per the contract PaywallOptions but not wired to a
      // live ad SDK or Stripe in this pass.
    },
    [premiumGate, unlock],
  );

  return (
    <div className="player" data-testid="player">
      <div
        className="player-surface"
        role="region"
        aria-label="Now playing"
        data-testid="player-surface"
        data-variant-id={current?.id ?? ""}
      >
        {current ? (
          <>
            <p data-testid="player-now-playing">
              Playing cut {current.id} ({current.tier}, intensity {current.intensity})
            </p>
            {active.captions && <p className="player-track" data-testid="track-captions">Captions on</p>}
            {active.audioDescription && (
              <p className="player-track" data-testid="track-audio-description">Audio description on</p>
            )}
            {active.sign && <p className="player-track" data-testid="track-sign">Sign language on</p>}
            <p className="player-track" data-testid="track-language">Language: {active.language}</p>
          </>
        ) : (
          <p role="status">Resolving the opening cut.</p>
        )}
      </div>

      <div className="player-controls">
        <button
          type="button"
          onClick={() => void advance()}
          disabled={state.advancing || state.ended || showPaywall}
          data-testid="player-advance"
        >
          {state.ended ? "Ended" : state.advancing ? "Loading" : "Continue"}
        </button>
        {state.error && (
          <p role="alert" data-testid="player-error">
            {state.error}
          </p>
        )}
      </div>

      <A11yControls
        prefs={prefs}
        active={active}
        availableLanguages={availableLanguages}
        onChange={onPrefsChange}
      />

      {showPaywall && premiumGate && (
        <Paywall
          title={`Premium: cut ${premiumGate.id}`}
          coinCost={premiumGate.coin_cost}
          balance={unlock.state.balance ?? 0}
          serverOptions={unlock.state.paywall ?? undefined}
          busy={unlock.state.status === "spending"}
          onChoose={onPaywallChoose}
          onDismiss={() => setShowPaywall(false)}
        />
      )}
    </div>
  );
}
