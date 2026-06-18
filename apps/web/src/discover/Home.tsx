// 20-V3 DISCOVER: the home rails. Continue-watching (GET /continue), Trending (GET /trending), and a
// credits balance pill driven by the existing wallet. Each rail owns its own loading (Skeleton),
// empty, and error state, and each tile opens its route. No dead ends: tapping a tile emits
// series_opened / continue_resumed and routes to the series detail or the player. No em dashes.

import { useEffect, useState } from "react";
import { CreditsPill, Skeleton, EmptyState, ErrorState } from "@axessplayer/ui";
import type { CatalogClient, ContinueItem, TrendingItem } from "../api/catalog.js";
import type { ViewerAnalytics } from "../analytics/analytics.js";

export interface HomeProps {
  catalog: CatalogClient;
  analytics: ViewerAnalytics;
  // Live coin balance for the header pill (null while loading).
  coins: number | null;
  // Resume a continue-watching item in the player.
  onResume: (item: ContinueItem) => void;
  // Open a series detail route.
  onOpenSeries: (seriesId: string) => void;
  // Open the search route.
  onOpenSearch: () => void;
}

type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

export function Home({ catalog, analytics, coins, onResume, onOpenSeries, onOpenSearch }: HomeProps) {
  const [cont, setCont] = useState<Load<ContinueItem[]>>({ status: "loading" });
  const [trend, setTrend] = useState<Load<TrendingItem[]>>({ status: "loading" });

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const items = await catalog.getContinue();
        if (live) setCont({ status: "ready", data: items });
      } catch (err) {
        if (live) setCont({ status: "error", message: err instanceof Error ? err.message : "Could not load" });
      }
    })();
    void (async () => {
      try {
        const items = await catalog.getTrending();
        if (live) setTrend({ status: "ready", data: items });
      } catch (err) {
        if (live) setTrend({ status: "error", message: err instanceof Error ? err.message : "Could not load" });
      }
    })();
    return () => {
      live = false;
    };
  }, [catalog]);

  return (
    <div className="scr dsc" data-testid="discover-home">
      <div className="feedhead">
        <span className="t">Discover</span>
        <CreditsPill amount={coins ?? "."} />
      </div>

      <button type="button" className="dsc__searchbar" onClick={onOpenSearch} data-testid="discover-search-open">
        <SearchGlyph />
        <span>Search shows, characters, channels</span>
      </button>

      <section className="dsc__rail" aria-labelledby="rail-continue">
        <h2 className="dsc__rail-title" id="rail-continue">
          Continue watching
        </h2>
        {cont.status === "loading" && <RailSkeleton testid="continue-skeleton" />}
        {cont.status === "error" && (
          <ErrorState title="Could not load your row">{cont.message}</ErrorState>
        )}
        {cont.status === "ready" && cont.data.length === 0 && (
          <EmptyState title="Nothing in progress">
            Start a series and it shows up here so you can pick up where you left off.
          </EmptyState>
        )}
        {cont.status === "ready" && cont.data.length > 0 && (
          <div className="dsc__row" role="list" data-testid="continue-row">
            {cont.data.map((item) => (
              <button
                key={item.seriesId + item.beatId}
                type="button"
                role="listitem"
                className="dsc__tile dsc__tile--wide"
                data-testid={`continue-tile-${item.seriesId}`}
                onClick={() => {
                  analytics.track("continue_resumed", { seriesId: item.seriesId, beatId: item.beatId });
                  onResume(item);
                }}
              >
                <Poster url={item.poster} alt={item.title} />
                <span className="dsc__tile-progress" aria-hidden>
                  <span style={{ width: `${Math.round((item.progress ?? 0) * 100)}%` }} />
                </span>
                <span className="dsc__tile-title">{item.title}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="dsc__rail" aria-labelledby="rail-trending">
        <h2 className="dsc__rail-title" id="rail-trending">
          Trending
        </h2>
        {trend.status === "loading" && <RailSkeleton testid="trending-skeleton" />}
        {trend.status === "error" && <ErrorState title="Could not load trending">{trend.message}</ErrorState>}
        {trend.status === "ready" && trend.data.length === 0 && (
          <EmptyState title="Nothing trending yet">Check back soon for the most-watched cuts.</EmptyState>
        )}
        {trend.status === "ready" && trend.data.length > 0 && (
          <div className="dsc__row" role="list" data-testid="trending-row">
            {trend.data.map((item) => (
              <button
                key={item.seriesId}
                type="button"
                role="listitem"
                className="dsc__tile"
                data-testid={`trending-tile-${item.seriesId}`}
                onClick={() => {
                  analytics.track("series_opened", { seriesId: item.seriesId, props: { source: "trending" } });
                  onOpenSeries(item.seriesId);
                }}
              >
                <Poster url={item.poster} alt={item.title} />
                <span className="dsc__tile-title">{item.title}</span>
                {item.genre && <span className="dsc__tile-genre">{item.genre}</span>}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Poster({ url, alt }: { url: string | null; alt: string }) {
  if (url) {
    return (
      <span
        className="dsc__poster"
        role="img"
        aria-label={alt}
        style={{ backgroundImage: `url(${url})` }}
      />
    );
  }
  return <span className="dsc__poster dsc__poster--blank" role="img" aria-label={alt} />;
}

function RailSkeleton({ testid }: { testid: string }) {
  return (
    <div className="dsc__row" aria-hidden data-testid={testid}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="dsc__tile">
          <Skeleton width={120} height={160} radius={14} />
          <Skeleton width={90} height={12} style={{ marginTop: 8 }} />
        </div>
      ))}
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
