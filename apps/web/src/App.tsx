// The consumer app shell, matching the prototype's Consumer app exactly: a phone frame on desktop,
// full-bleed on mobile, with four screens (Feed / Player / Wallet / Profile) and the light bottom nav.
// It loads the real series graph and the real wallet, opens the live adaptive player on the real
// series card, and routes the bottom nav. Identity rides the session token; no user_id is ever sent in
// a body (F1). No em dashes.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Clients } from "./clients.js";
import { createCaptureClient, noopCapture } from "./capture/capture.js";
import type { SeriesGraph, FeedItem } from "./api/content.js";
import { coldOpenBeat } from "./api/content.js";
import type { Wallet as WalletData } from "./api/economy.js";
import { Feed } from "./feed/Feed.js";
import { Player } from "./player/Player.js";
import { WalletScreen } from "./wallet/Wallet.js";
import { Profile } from "./profile/Profile.js";
import { BottomNav, type Tab } from "./ui/BottomNav.js";
import { StatusBar } from "./ui/StatusBar.js";
import type { ConsentControls } from "./consent/useConsent.js";
import { useAuth } from "./auth/AuthProvider.js";
import { SignInPrompt } from "./auth/SignInPrompt.js";

export interface AppProps {
  clients: Clients;
  seriesId: string;
  // The viewing identity. Used only to drive the SDK BranchingPlayer; it is stripped before the wire
  // (the session token is the real identity). See player/webTransport.ts.
  userId: string;
  // Display name for the profile screen.
  viewerName?: string;
  // Consent controls, passed when the app is mounted behind the consent gate (Root). Profile uses them to
  // show the GDPR data-subject actions. Optional so the app shell can still be rendered in isolation.
  consent?: ConsentControls;
}

type Screen = "feed" | "player" | "wallet" | "profile";

export function App({ clients, seriesId, userId, viewerName = "Malena", consent }: AppProps) {
  const [graph, setGraph] = useState<SeriesGraph | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("feed");

  // Refresh the published feed (GET /feed). Called on mount and whenever returning to the feed, so a publish
  // or unpublish in the Studio is reflected without a full reload.
  const refreshFeed = useCallback(async () => {
    try {
      setFeed(await clients.content.getFeed());
    } catch {
      // A feed load failure leaves the last known feed; the per-series graph load surfaces hard errors.
    }
  }, [clients]);

  const refreshWallet = useCallback(async () => {
    try {
      setWallet(await clients.economy.getWallet());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "wallet load failed");
    }
  }, [clients]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const g = await clients.content.getSeriesGraph(seriesId);
        if (live) setGraph(g);
      } catch (err) {
        if (live) setLoadError(err instanceof Error ? err.message : "graph load failed");
      }
    })();
    void refreshWallet();
    void refreshFeed();
    return () => {
      live = false;
    };
  }, [clients, seriesId, refreshWallet, refreshFeed]);

  // Open a published series in the player. The graph for the configured series is preloaded; opening a
  // different published series loads its graph first.
  const openSeries = useCallback(
    async (id: string) => {
      try {
        if (!graph || graph.series.id !== id) {
          setGraph(await clients.content.getSeriesGraph(id));
        }
        setScreen("player");
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "graph load failed");
      }
    },
    [clients, graph],
  );

  const coins = wallet?.balance ?? null;

  // Phase 0 capture is consent-gated: only when the viewer granted analytics_personalization do we measure
  // real signals for /decide and emit beat-level events. Otherwise a noop capture and personalize=false.
  const personalize = consent?.record?.purposes.analytics_personalization ?? false;
  const capture = useMemo(
    () => (personalize ? createCaptureClient({ seriesId, enabled: () => true }) : noopCapture),
    [personalize, seriesId],
  );

  // The C12 auth boundary, applied at the app shell. Browsing the feed needs NO auth; the wallet and
  // profile ("You") tabs require a signed-in viewer, so first navigation there prompts sign in via the
  // reusable gate. The feed is always reachable. Identity is the session subject, never a body field (F1).
  const auth = useAuth();
  const onNavigate = useCallback(
    (tab: Tab) => {
      if (tab === "home") {
        setScreen("feed");
        void refreshFeed();
        return;
      }
      const target: Screen = tab === "you" ? "profile" : "wallet";
      // When auth is not configured in this environment, preserve the existing live experience: the wallet
      // and profile remain reachable (the demo session drives them). When auth IS configured, enforce the
      // C12 boundary and resume to the target on a successful sign in.
      if (!auth.configured) {
        setScreen(target);
        return;
      }
      void auth.requireAuth(target).then((ok) => {
        if (ok) setScreen(target);
      });
    },
    [refreshFeed, auth],
  );

  const content = () => {
    if (loadError) {
      return (
        <div className="frame-state" role="alert" data-testid="app-error">
          {loadError}
        </div>
      );
    }

    if (screen === "player") {
      if (!graph) {
        return (
          <div className="frame-state" role="status">
            Loading.
          </div>
        );
      }
      const start = coldOpenBeat(graph);
      if (!start) {
        return (
          <div className="frame-state" role="alert">
            This series has no playable beats yet.
          </div>
        );
      }
      return (
        <div className="scr" data-testid="screen-player">
          <Player
            graph={graph}
            transport={clients.playerTransport()}
            economy={clients.economy}
            rewards={clients.rewards}
            seriesId={seriesId}
            userId={userId}
            startBeatId={start.id}
            onBack={() => setScreen("feed")}
            onBalanceChange={() => void refreshWallet()}
            capture={capture}
            personalize={personalize}
          />
        </div>
      );
    }

    if (screen === "wallet") {
      return (
        <div className="scr" data-testid="screen-wallet">
          <StatusBar />
          <div className="feedhead">
            <span className="t">Wallet</span>
          </div>
          <WalletScreen
            wallet={wallet}
            userId={userId}
            rewards={clients.rewards}
            onEarned={() => void refreshWallet()}
          />
          <BottomNav active="wallet" onNavigate={onNavigate} />
        </div>
      );
    }

    if (screen === "profile") {
      return (
        <div className="scr" data-testid="screen-profile">
          <StatusBar />
          <div className="feedhead">
            <span className="t">You</span>
          </div>
          <Profile name={viewerName} coins={coins} consent={consent} />
          <BottomNav active="you" onNavigate={onNavigate} />
        </div>
      );
    }

    // feed
    return (
      <div className="scr" data-testid="screen-feed">
        <StatusBar />
        <Feed feed={feed} coins={coins} onOpen={(id) => void openSeries(id)} />
        <BottomNav active="home" onNavigate={onNavigate} />
      </div>
    );
  };

  return (
    <div className="app-stage">
      <div className="phone">
        <div className="notch" />
        {content()}
        {/* C12 reusable sign-in gate. Renders nothing until a gated action calls requireAuth(). */}
        <SignInPrompt seriesId={seriesId} />
      </div>
    </div>
  );
}
