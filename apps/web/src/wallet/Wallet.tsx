// The wallet screen. The balance is read from the server, never computed client-side as truth (golden
// rule 5). Buy coins stays disabled until the paywall/Stripe TEST surface lands. "Earn free coins" is LIVE:
// each earn action calls a SERVER-SIDE reward callback (the settlement service), which verifies and calls
// economy /grant service-to-service. The browser never mints coins. The rewarded ad enforces a server-side
// daily cap, surfaced here. Amounts (25 per ad) are flagged for the money sign-off. No em dashes.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Wallet as WalletData } from "../api/economy.js";
import type { RewardsClient } from "../api/rewards.js";

export interface WalletScreenProps {
  wallet: WalletData | null;
  loading?: boolean;
  userId?: string;
  rewards?: RewardsClient;
  // Called after a successful earn so the parent refreshes the server balance.
  onEarned?: () => void;
}

type AdPhase = "idle" | "playing" | "claiming";

export function WalletScreen({ wallet, loading, userId, rewards, onEarned }: WalletScreenProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "checkin" | "follow">(null);
  const [adPhase, setAdPhase] = useState<AdPhase>("idle");
  const [countdown, setCountdown] = useState(0);
  const [ads, setAds] = useState<{ count: number; cap: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshAds = useCallback(() => {
    if (rewards && userId) void rewards.adsToday(userId).then(setAds).catch(() => {});
  }, [rewards, userId]);

  useEffect(() => {
    refreshAds();
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [refreshAds]);

  const capReached = ads != null && ads.count >= ads.cap;

  const claimAd = useCallback(async () => {
    if (!rewards || !userId) return;
    setAdPhase("claiming");
    try {
      const impressionId = `imp-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
      const r = await rewards.watchRewardedAd(userId, impressionId);
      if (r.capReached) setStatus(`Daily limit reached (${r.today}/${r.cap}). Come back tomorrow.`);
      else if (r.granted) {
        setStatus("+25 coins earned");
        onEarned?.();
      } else setStatus("Reward not granted.");
    } catch {
      setStatus("Could not verify the ad. Try again.");
    } finally {
      setAdPhase("idle");
      refreshAds();
    }
  }, [rewards, userId, onEarned, refreshAds]);

  // Rewarded ad: play a short dev rewarded-video (a countdown stands in for the SDK), then on completion
  // call the server-side reward callback. In production the ad network's SSV callback hits the same endpoint.
  const startAd = useCallback(() => {
    if (!rewards || !userId || adPhase !== "idle") return;
    setStatus(null);
    setAdPhase("playing");
    setCountdown(3);
    timer.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (timer.current) clearInterval(timer.current);
          void claimAd();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }, [rewards, userId, adPhase, claimAd]);

  const earn = useCallback(
    async (kind: "checkin" | "follow") => {
      if (!rewards || !userId || busy) return;
      setBusy(kind);
      setStatus(null);
      try {
        const r = kind === "checkin" ? await rewards.checkin(userId) : await rewards.follow(userId);
        setStatus(r.granted ? (kind === "checkin" ? "Daily check-in claimed" : "Follow bonus claimed") : "Already claimed");
        if (r.granted) onEarned?.();
      } catch {
        setStatus("Something went wrong. Try again.");
      } finally {
        setBusy(null);
      }
    },
    [rewards, userId, busy, onEarned],
  );

  const live = Boolean(rewards && userId);

  return (
    <div className="pad" data-testid="wallet">
      <div className="bal">
        <div className="eyw">Balance</div>
        <div className="n">
          <b data-testid="wallet-balance">{loading || !wallet ? "…" : wallet.balance}</b> coins
        </div>
      </div>

      {status && (
        <div className="statusline" role="status" data-testid="wallet-status" style={{ margin: "8px 0" }}>
          {status}
        </div>
      )}

      <div className="scaption">Buy coins</div>
      <div className="row">
        <div className="ic"><span className="gcoin" /></div>
        <div style={{ flex: 1 }}>
          <div>50 coins</div>
          <div className="muted">Most popular</div>
        </div>
        <button type="button" className="pricebtn pri" disabled aria-label="Buy 50 coins for $4.99">
          $4.99
        </button>
      </div>
      <div className="row">
        <div className="ic"><span className="gcoin" /></div>
        <div style={{ flex: 1 }}>
          <div>120 coins</div>
          <div className="muted">+20 bonus</div>
        </div>
        <button type="button" className="pricebtn" disabled aria-label="Buy 120 coins for $9.99">
          $9.99
        </button>
      </div>

      <div className="scaption">
        Earn free coins
        {ads && (
          <span className="muted" data-testid="ad-cap" style={{ float: "right", fontWeight: 400 }}>
            Ads today {ads.count}/{ads.cap}
          </span>
        )}
      </div>

      <div className="row">
        <div className="ic" aria-hidden="true">▶</div>
        <div style={{ flex: 1 }}>
          Watch a rewarded ad <span className="muted">+25</span>
        </div>
        <button
          type="button"
          className="pricebtn pri"
          disabled={!live || adPhase !== "idle" || capReached}
          onClick={startAd}
          data-testid="earn-ad"
          aria-label="Watch a rewarded ad to earn 25 coins"
        >
          {capReached ? "Maxed" : adPhase === "idle" ? "Watch" : "…"}
        </button>
      </div>

      <div className="row">
        <div className="ic" aria-hidden="true">✓</div>
        <div style={{ flex: 1 }}>
          Daily check-in <span className="muted">+5</span>
        </div>
        <button
          type="button"
          className="pricebtn"
          disabled={!live || busy === "checkin"}
          onClick={() => void earn("checkin")}
          data-testid="earn-checkin"
          aria-label="Claim the daily check-in"
        >
          {busy === "checkin" ? "…" : "Claim"}
        </button>
      </div>

      <div className="row">
        <div className="ic" aria-hidden="true">＋</div>
        <div style={{ flex: 1 }}>
          Follow bonus <span className="muted">+25 once</span>
        </div>
        <button
          type="button"
          className="pricebtn"
          disabled={!live || busy === "follow"}
          onClick={() => void earn("follow")}
          data-testid="earn-follow"
          aria-label="Claim the one-time follow bonus"
        >
          {busy === "follow" ? "…" : "Claim"}
        </button>
      </div>

      <div className="scaption">Unlocked</div>
      {!wallet || wallet.entitlements.length === 0 ? (
        <div className="muted" data-testid="wallet-empty">Nothing unlocked yet.</div>
      ) : (
        <div data-testid="wallet-entitlements">
          {wallet.entitlements.map((e) => (
            <div className="row" key={`${e.scope}:${e.scope_id}`}>
              <div className="ic" aria-hidden="true">◆</div>
              <div style={{ flex: 1 }}>
                {labelFor(e.scope)} <span className="muted">{shortId(e.scope_id)}</span>
              </div>
              <span className="owned">OWNED</span>
            </div>
          ))}
        </div>
      )}

      {/* Rewarded-video overlay (dev stand-in for the SDK). The grant happens server-side on completion. */}
      {adPhase !== "idle" && (
        <div
          className="sheet up"
          role="dialog"
          aria-modal="true"
          aria-label="Rewarded ad"
          data-testid="ad-overlay"
          style={{ textAlign: "center" }}
        >
          <div className="axp-eyebrow">Rewarded ad</div>
          <h3>{adPhase === "claiming" ? "Granting your reward..." : `Ad playing... ${countdown}`}</h3>
          <p className="muted">Watch to the end to earn 25 coins. The reward is granted by the server.</p>
        </div>
      )}
    </div>
  );
}

function labelFor(scope: string): string {
  return scope === "beat_variant" ? "Alt cut" : scope;
}

function shortId(id: string): string {
  return id.length > 8 ? `…${id.slice(-6)}` : id;
}
