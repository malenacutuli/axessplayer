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
import { useRouter, matchPath } from "./router/router.js";
import { createViewerAnalytics } from "./analytics/analytics.js";
import { Onboarding } from "./onboarding/Onboarding.js";
import { Home as Discover } from "./discover/Home.js";
import { SeriesDetail } from "./discover/SeriesDetail.js";
import { Search } from "./discover/Search.js";
import { Channel } from "./discover/Channel.js";
import { Channels } from "./discover/Channels.js";
import { Library, type LibraryTab } from "./library/Library.js";

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
      // 401 = signed out (guests watch free; the wallet needs sign-in). Not an app error: leave it empty.
      if ((err as { status?: unknown }).status === 401) {
        setWallet(null);
        return;
      }
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

  // The client router (dependency-free, History API). The existing feed/player/wallet/profile experience
  // lives under "/" and "/home" and keeps switching via the `screen` state; the 20-V1 / 20-V3 surfaces are
  // real, linkable, back-button-safe routes added additively on top.
  const router = useRouter();

  // The viewer-surface analytics emitter (canonical taxonomy from @axessplayer/analytics-sdk). One
  // instance per session id so onboarding, discover, detail, and search all emit with one envelope.
  const analytics = useMemo(() => createViewerAnalytics({ sessionId: userId }), [userId]);

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
      // Search is a real route (20-V3). Navigating there leaves the home screen machine and the back
      // button returns the viewer here.
      if (tab === "search") {
        if (router.path !== "/") router.navigate("/");
        setScreen("feed");
        router.navigate("/search");
        return;
      }
      if (tab === "home") {
        if (router.path !== "/") router.navigate("/");
        setScreen("feed");
        void refreshFeed();
        return;
      }
      const target: Screen = tab === "you" ? "profile" : "wallet";
      // When auth is not configured in this environment, preserve the existing live experience: the wallet
      // and profile remain reachable (the demo session drives them). When auth IS configured, enforce the
      // C12 boundary and resume to the target on a successful sign in.
      const goHomeRoute = () => {
        if (router.path !== "/") router.navigate("/");
      };
      if (!auth.configured) {
        goHomeRoute();
        setScreen(target);
        return;
      }
      void auth.requireAuth(target).then((ok) => {
        if (ok) {
          goHomeRoute();
          setScreen(target);
        }
      });
    },
    [refreshFeed, auth, router],
  );

  // Open a series DETAIL route (20-V3 merchandising) by id. Used by the discover rails and search.
  const openSeriesDetail = useCallback(
    (id: string) => {
      router.navigate(`/series/${encodeURIComponent(id)}`);
    },
    [router],
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
            cuts={clients.cuts}
            analytics={analytics}
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
          <Profile
            name={viewerName}
            coins={coins}
            consent={consent}
            onOpenLibrary={(tab) => router.navigate(`/library?tab=${tab}`)}
          />
          <BottomNav active="you" onNavigate={onNavigate} />
        </div>
      );
    }

    // feed
    return (
      <div className="scr" data-testid="screen-feed">
        <StatusBar />
        <Feed
          feed={feed}
          coins={coins}
          onOpen={(id) => void openSeries(id)}
          onOpenChannels={() => router.navigate("/channels")}
          experiment={clients.experiment}
          unit={userId}
        />
        <BottomNav active="home" onNavigate={onNavigate} />
      </div>
    );
  };

  // Route the 20-V1 / 20-V3 surfaces. These are additive: when the path is "/" or "/home" we fall through
  // to the existing feed/player/wallet/profile screen machine, so the live experience is untouched.
  const routed = (): JSX.Element | null => {
    const path = router.path;

    if (path === "/onboarding") {
      return (
        <div className="scr" data-testid="route-onboarding">
          <StatusBar />
          <Onboarding
            catalog={clients.catalog}
            analytics={analytics}
            seriesId={seriesId}
            onPlay={() => {
              // Play episode 1 triggers the first /decide using the calibration: open the live player.
              router.navigate("/");
              void openSeries(seriesId);
            }}
            onSkip={() => {
              router.navigate("/");
              setScreen("feed");
            }}
          />
        </div>
      );
    }

    if (path === "/discover") {
      return (
        <div className="scr" data-testid="route-discover">
          <StatusBar />
          <Discover
            catalog={clients.catalog}
            analytics={analytics}
            coins={coins}
            experiment={clients.experiment}
            unit={userId}
            onResume={(item) => {
              router.navigate("/");
              void openSeries(item.seriesId);
            }}
            onOpenSeries={openSeriesDetail}
            onOpenSearch={() => router.navigate("/search")}
            onOpenChannels={() => router.navigate("/channels")}
          />
          <BottomNav active="home" onNavigate={onNavigate} />
        </div>
      );
    }

    if (path === "/search") {
      return (
        <div className="scr" data-testid="route-search">
          <StatusBar />
          <Search
            catalog={clients.catalog}
            analytics={analytics}
            onBack={() => router.back()}
            onOpenSeries={openSeriesDetail}
            onOpenChannel={(id) => router.navigate(`/channel/${encodeURIComponent(id)}`)}
          />
          <BottomNav active="search" onNavigate={onNavigate} />
        </div>
      );
    }

    const seriesMatch = matchPath("/series/:id", path);
    if (seriesMatch) {
      return (
        <div className="scr" data-testid="route-series-detail">
          <StatusBar />
          <SeriesDetail
            seriesId={seriesMatch.id}
            catalog={clients.catalog}
            library={clients.library}
            cuts={clients.cuts}
            economy={clients.economy}
            analytics={analytics}
            experiment={clients.experiment}
            unit={userId}
            onBack={() => router.back()}
            onPlay={() => {
              router.navigate("/");
              void openSeries(seriesMatch.id);
            }}
          />
        </div>
      );
    }

    if (path === "/channels") {
      return (
        <div className="scr" data-testid="route-channels">
          <StatusBar />
          <Channels
            catalog={clients.catalog}
            onOpenChannel={(id) => router.navigate(`/channel/${encodeURIComponent(id)}`)}
          />
          <BottomNav active="home" onNavigate={onNavigate} />
        </div>
      );
    }

    const channelMatch = matchPath("/channel/:id", path);
    if (channelMatch) {
      return (
        <div className="scr" data-testid="route-channel">
          <StatusBar />
          <Channel
            channelId={channelMatch.id}
            catalog={clients.catalog}
            library={clients.library}
            analytics={analytics}
            onBack={() => router.back()}
            onOpenSeries={openSeriesDetail}
          />
        </div>
      );
    }

    if (path === "/library") {
      const tabParam = router.query.get("tab");
      const validTabs: LibraryTab[] = ["saved", "downloads", "history", "favorites"];
      const initialTab = validTabs.includes(tabParam as LibraryTab) ? (tabParam as LibraryTab) : "saved";
      return (
        <div className="scr" data-testid="route-library">
          <StatusBar />
          <Library
            library={clients.library}
            analytics={analytics}
            initialTab={initialTab}
            onBack={() => router.back()}
            onOpenSeries={openSeriesDetail}
            onResume={(id) => {
              router.navigate("/");
              void openSeries(id);
            }}
          />
          <BottomNav active="you" onNavigate={onNavigate} />
        </div>
      );
    }

    return null;
  };

  return (
    <div className="app-stage">
      <div className="phone">
        <div className="notch" />
        {routed() ?? content()}
        {/* C12 reusable sign-in gate. Renders nothing until a gated action calls requireAuth(). */}
        <SignInPrompt seriesId={seriesId} />
      </div>
    </div>
  );
}
