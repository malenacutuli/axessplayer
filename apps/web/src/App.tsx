// The consumer app shell, matching the prototype's Consumer app exactly: a phone frame on desktop,
// full-bleed on mobile, with four screens (Feed / Player / Wallet / Profile) and the light bottom nav.
// It loads the real series graph and the real wallet, opens the live adaptive player on the real
// series card, and routes the bottom nav. Identity rides the session token; no user_id is ever sent in
// a body (F1). No em dashes.

import { useCallback, useEffect, useState } from "react";
import type { Clients } from "./clients.js";
import type { SeriesGraph } from "./api/content.js";
import { coldOpenBeat } from "./api/content.js";
import type { Wallet as WalletData } from "./api/economy.js";
import { Feed } from "./feed/Feed.js";
import { Player } from "./player/Player.js";
import { WalletScreen } from "./wallet/Wallet.js";
import { Profile } from "./profile/Profile.js";
import { BottomNav, type Tab } from "./ui/BottomNav.js";
import { StatusBar } from "./ui/StatusBar.js";

export interface AppProps {
  clients: Clients;
  seriesId: string;
  // The viewing identity. Used only to drive the SDK BranchingPlayer; it is stripped before the wire
  // (the session token is the real identity). See player/webTransport.ts.
  userId: string;
  // Display name for the profile screen.
  viewerName?: string;
}

type Screen = "feed" | "player" | "wallet" | "profile";

export function App({ clients, seriesId, userId, viewerName = "Malena" }: AppProps) {
  const [graph, setGraph] = useState<SeriesGraph | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("feed");

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
    return () => {
      live = false;
    };
  }, [clients, seriesId, refreshWallet]);

  const coins = wallet?.balance ?? null;

  const onNavigate = useCallback((tab: Tab) => {
    setScreen(tab === "home" ? "feed" : tab === "you" ? "profile" : "wallet");
  }, []);

  const content = () => {
    if (loadError) {
      return (
        <div className="frame-state" role="alert" data-testid="app-error">
          {loadError}
        </div>
      );
    }
    if (!graph) {
      return (
        <div className="frame-state" role="status">
          Loading.
        </div>
      );
    }

    if (screen === "player") {
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
            userId={userId}
            startBeatId={start.id}
            onBack={() => setScreen("feed")}
            onBalanceChange={() => void refreshWallet()}
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
          <WalletScreen wallet={wallet} />
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
          <Profile name={viewerName} coins={coins} />
          <BottomNav active="you" onNavigate={onNavigate} />
        </div>
      );
    }

    // feed
    return (
      <div className="scr" data-testid="screen-feed">
        <StatusBar />
        <Feed graph={graph} coins={coins} onOpen={() => setScreen("player")} />
        <BottomNav active="home" onNavigate={onNavigate} />
      </div>
    );
  };

  return (
    <div className="app-stage">
      <div className="phone">
        <div className="notch" />
        {content()}
      </div>
    </div>
  );
}
