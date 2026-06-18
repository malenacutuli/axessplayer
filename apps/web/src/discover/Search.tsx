// 20-V3 DISCOVER: search (route /search). One box, typeahead (debounced) hitting GET /search and
// returning shows / characters / channels. Each result opens its route (a show -> series detail, a
// channel -> channel route, a character -> its series). Real loading (Skeleton), empty, and error
// states; the box emits search_performed (debounced) and each open emits series_opened. No dead ends.
// No em dashes.

import { useCallback, useEffect, useRef, useState } from "react";
import { Skeleton, EmptyState, ErrorState } from "@axessplayer/ui";
import type { CatalogClient, SearchResults } from "../api/catalog.js";
import type { ViewerAnalytics } from "../analytics/analytics.js";

export interface SearchProps {
  catalog: CatalogClient;
  analytics: ViewerAnalytics;
  onBack: () => void;
  onOpenSeries: (seriesId: string) => void;
  onOpenChannel: (channelId: string) => void;
}

type Load =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: SearchResults };

const DEBOUNCE_MS = 250;

export function Search({ catalog, analytics, onBack, onOpenSeries, onOpenChannel }: SearchProps) {
  const [q, setQ] = useState("");
  const [load, setLoad] = useState<Load>({ status: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqId = useRef(0);

  const run = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (trimmed.length === 0) {
        setLoad({ status: "idle" });
        return;
      }
      setLoad({ status: "loading" });
      const id = ++reqId.current;
      analytics.track("search_performed", { props: { q: trimmed } });
      void (async () => {
        try {
          const data = await catalog.search(trimmed);
          if (id === reqId.current) setLoad({ status: "ready", data });
        } catch (err) {
          if (id === reqId.current)
            setLoad({ status: "error", message: err instanceof Error ? err.message : "Search failed" });
        }
      })();
    },
    [catalog, analytics],
  );

  // Debounced typeahead.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(q), DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, run]);

  const empty =
    load.status === "ready" &&
    load.data.shows.length === 0 &&
    load.data.characters.length === 0 &&
    load.data.channels.length === 0;

  return (
    <div className="scr srch" data-testid="search">
      <div className="srch__bar">
        <button type="button" className="srch__back" onClick={onBack} aria-label="Back" data-testid="search-back">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <input
          type="search"
          className="srch__input"
          placeholder="Shows, characters, channels"
          aria-label="Search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="search-input"
        />
      </div>

      <div className="srch__results">
        {load.status === "idle" && (
          <EmptyState title="Search Axessplayer">
            Find a show, a character, or a channel. Results update as you type.
          </EmptyState>
        )}

        {load.status === "loading" && (
          <div aria-hidden data-testid="search-skeleton">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="srch__row">
                <Skeleton width={44} height={44} radius={10} />
                <Skeleton width={160} height={14} />
              </div>
            ))}
          </div>
        )}

        {load.status === "error" && (
          <ErrorState title="Search failed">{load.message}</ErrorState>
        )}

        {empty && <EmptyState title="No matches">Nothing matched that search. Try another term.</EmptyState>}

        {load.status === "ready" && !empty && (
          <>
            {load.data.shows.length > 0 && (
              <section aria-labelledby="srch-shows">
                <h2 className="srch__group" id="srch-shows">
                  Shows
                </h2>
                <ul className="srch__list" data-testid="search-shows">
                  {load.data.shows.map((s) => (
                    <li key={s.seriesId}>
                      <button
                        type="button"
                        className="srch__item"
                        data-testid={`search-show-${s.seriesId}`}
                        onClick={() => {
                          analytics.track("series_opened", { seriesId: s.seriesId, props: { source: "search" } });
                          onOpenSeries(s.seriesId);
                        }}
                      >
                        <span
                          className={`srch__thumb ${s.poster ? "" : "srch__thumb--blank"}`}
                          style={s.poster ? { backgroundImage: `url(${s.poster})` } : undefined}
                          aria-hidden
                        />
                        <span className="srch__item-main">
                          <span className="srch__item-title">{s.title}</span>
                          {s.genre && <span className="srch__item-sub">{s.genre}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {load.data.characters.length > 0 && (
              <section aria-labelledby="srch-chars">
                <h2 className="srch__group" id="srch-chars">
                  Characters
                </h2>
                <ul className="srch__list" data-testid="search-characters">
                  {load.data.characters.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="srch__item"
                        data-testid={`search-character-${c.id}`}
                        onClick={() => {
                          analytics.track("series_opened", {
                            seriesId: c.seriesId,
                            props: { source: "search_character", characterId: c.id },
                          });
                          onOpenSeries(c.seriesId);
                        }}
                      >
                        <span className="srch__thumb srch__thumb--round srch__thumb--blank" aria-hidden />
                        <span className="srch__item-main">
                          <span className="srch__item-title">{c.name}</span>
                          {c.seriesTitle && <span className="srch__item-sub">{c.seriesTitle}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {load.data.channels.length > 0 && (
              <section aria-labelledby="srch-channels">
                <h2 className="srch__group" id="srch-channels">
                  Channels
                </h2>
                <ul className="srch__list" data-testid="search-channels">
                  {load.data.channels.map((ch) => (
                    <li key={ch.id}>
                      <button
                        type="button"
                        className="srch__item"
                        data-testid={`search-channel-${ch.id}`}
                        onClick={() => {
                          analytics.track("channel_followed", {
                            props: { channelId: ch.id, source: "search_open" },
                          });
                          onOpenChannel(ch.id);
                        }}
                      >
                        <span className="srch__thumb srch__thumb--blank" aria-hidden />
                        <span className="srch__item-main">
                          <span className="srch__item-title">{ch.name}</span>
                          <span className="srch__item-sub">Channel</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
