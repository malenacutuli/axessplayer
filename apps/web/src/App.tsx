// The app shell. Loads the series graph and the wallet, shows the vertical feed, and opens the
// adaptive player on selection. Identity rides the session token; no user_id is ever sent in a body
// (F1). This is the browser twin of the native consumer app over the identical contracts. No em dashes.

import { useCallback, useEffect, useState } from "react";
import type { Clients } from "./clients.js";
import type { EpisodeNode, SeriesGraph } from "./api/content.js";
import { coldOpenBeat } from "./api/content.js";
import type { Wallet as WalletData } from "./api/economy.js";
import { Feed } from "./feed/Feed.js";
import { Player } from "./player/Player.js";
import { Wallet } from "./wallet/Wallet.js";

export interface AppProps {
  clients: Clients;
  seriesId: string;
  // The viewing identity. Used only to drive the SDK BranchingPlayer; it is stripped before the wire
  // (the session token is the real identity). See player/webTransport.ts.
  userId: string;
}

type View = { kind: "feed" } | { kind: "player"; episode: EpisodeNode };

export function App({ clients, seriesId, userId }: AppProps) {
  const [graph, setGraph] = useState<SeriesGraph | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "feed" });

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

  if (loadError) {
    return (
      <main className="app">
        <p role="alert" data-testid="app-error">
          {loadError}
        </p>
      </main>
    );
  }

  if (!graph) {
    return (
      <main className="app">
        <p role="status">Loading.</p>
      </main>
    );
  }

  const transport = clients.playerTransport();
  const start = coldOpenBeat(graph);

  return (
    <main className="app">
      <header className="app-header">
        <h1>{graph.series.title}</h1>
      </header>

      {view.kind === "feed" ? (
        <Feed graph={graph} onOpen={(episode) => setView({ kind: "player", episode })} />
      ) : (
        <>
          <button type="button" onClick={() => setView({ kind: "feed" })} data-testid="back-to-feed">
            Back to feed
          </button>
          {start && (
            <Player
              graph={graph}
              transport={transport}
              economy={clients.economy}
              userId={userId}
              startBeatId={start.id}
              onBalanceChange={() => void refreshWallet()}
            />
          )}
        </>
      )}

      <aside className="app-wallet">
        <Wallet wallet={wallet} />
      </aside>
    </main>
  );
}
