// 20-V2 CHANNELS: the channels grid (route /channels). GET /channels returns the 9 channels, each with
// a hero, name, genres, and showCount. Each card opens its channel page (/channel/:id). Owns its own
// loading (Skeleton), empty, and error state. No dead ends: every card routes to its channel detail.
// No em dashes.

import { useCallback, useEffect, useState } from "react";
import { Skeleton, EmptyState, ErrorState, Button } from "@axessplayer/ui";
import type { CatalogClient, ChannelSummary } from "../api/catalog.js";

export interface ChannelsProps {
  catalog: CatalogClient;
  onOpenChannel: (channelId: string) => void;
}

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: ChannelSummary[] };

export function Channels({ catalog, onOpenChannel }: ChannelsProps) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  const fetchChannels = useCallback(() => {
    setLoad({ status: "loading" });
    let live = true;
    void (async () => {
      try {
        const data = await catalog.getChannels();
        if (live) setLoad({ status: "ready", data });
      } catch (err) {
        if (live) setLoad({ status: "error", message: err instanceof Error ? err.message : "Could not load" });
      }
    })();
    return () => {
      live = false;
    };
  }, [catalog]);

  useEffect(() => fetchChannels(), [fetchChannels]);

  return (
    <div className="scr chns" data-testid="channels">
      <div className="feedhead">
        <span className="t">Channels</span>
      </div>

      {load.status === "loading" && (
        <div className="chns__grid" aria-hidden data-testid="channels-skeleton">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="chns__card">
              <Skeleton width="100%" height={120} radius={16} />
              <Skeleton width={90} height={14} style={{ marginTop: 10 }} />
            </div>
          ))}
        </div>
      )}

      {load.status === "error" && (
        <div className="chns__body">
          <ErrorState
            title="Could not load channels"
            action={
              <Button variant="secondary" onClick={fetchChannels}>
                Try again
              </Button>
            }
          >
            {load.message}
          </ErrorState>
        </div>
      )}

      {load.status === "ready" && load.data.length === 0 && (
        <div className="chns__body">
          <EmptyState title="No channels yet">Channels will appear here as soon as they launch.</EmptyState>
        </div>
      )}

      {load.status === "ready" && load.data.length > 0 && (
        <div className="chns__grid" role="list" data-testid="channels-grid">
          {load.data.map((c) => (
            <button
              key={c.id}
              type="button"
              role="listitem"
              className="chns__card chns__card--btn"
              data-testid={`channel-card-${c.id}`}
              onClick={() => onOpenChannel(c.id)}
            >
              <span
                className={`chns__hero ${c.heroUrl ? "" : "chns__hero--blank"}`}
                role="img"
                aria-label={c.name}
                style={c.heroUrl ? { backgroundImage: `url(${c.heroUrl})` } : undefined}
              >
                <span className="chns__hero-grad" aria-hidden />
                <span className="chns__name">{c.name}</span>
              </span>
              <span className="chns__meta">
                <span className="chns__count">
                  {c.showCount} {c.showCount === 1 ? "show" : "shows"}
                </span>
                {c.genres.length > 0 && <span className="chns__genres">{c.genres.slice(0, 2).join(" / ")}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
