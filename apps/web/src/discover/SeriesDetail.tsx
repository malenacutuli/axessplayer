// 20-V3 DISCOVER: series detail (route /series/:id). Merchandising from GET /series/:id/detail: poster
// hero, genre, episode count, ENDINGS count, accessibility chips (CC / AD / SIGN / N LANG via the
// @axessplayer/ui A11yBadge), the episode list with per-episode credit cost + lock, and add-to-list
// (save). Real loading (Skeleton), empty, and error states; every control emits its analytics event.
// No dead ends: a locked episode opens the unlock intent (emits unlock_shown) and Play opens the player.
// No em dashes.

import { useCallback, useEffect, useState } from "react";
import {
  A11yBadge,
  Button,
  CreditsPill,
  Skeleton,
  EmptyState,
  ErrorState,
} from "@axessplayer/ui";
import type { CatalogClient, SeriesDetail as SeriesDetailData, SeriesEpisode } from "../api/catalog.js";
import type { ViewerAnalytics } from "../analytics/analytics.js";

export interface SeriesDetailProps {
  seriesId: string;
  catalog: CatalogClient;
  analytics: ViewerAnalytics;
  onBack: () => void;
  // Open the live adaptive player on this series (Play / unlocked episode).
  onPlay: (episode: SeriesEpisode) => void;
}

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: SeriesDetailData };

export function SeriesDetail({ seriesId, catalog, analytics, onBack, onPlay }: SeriesDetailProps) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [saved, setSaved] = useState(false);

  const fetchDetail = useCallback(() => {
    setLoad({ status: "loading" });
    let live = true;
    void (async () => {
      try {
        const data = await catalog.getSeriesDetail(seriesId);
        if (live) setLoad({ status: "ready", data });
      } catch (err) {
        if (live) setLoad({ status: "error", message: err instanceof Error ? err.message : "Could not load" });
      }
    })();
    return () => {
      live = false;
    };
  }, [catalog, seriesId]);

  useEffect(() => fetchDetail(), [fetchDetail]);

  // Optimistic add-to-list. Save / unsave are the canonical taxonomy events.
  const toggleSave = useCallback(() => {
    setSaved((prev) => {
      const next = !prev;
      analytics.track(next ? "save" : "unsave", { seriesId });
      return next;
    });
  }, [analytics, seriesId]);

  if (load.status === "loading") {
    return (
      <div className="scr sd" data-testid="series-detail-loading">
        <DetailHeader onBack={onBack} />
        <Skeleton width="100%" height={220} radius={0} />
        <div className="sd__body">
          <Skeleton width={180} height={22} />
          <Skeleton width={120} height={14} style={{ marginTop: 10 }} />
          <Skeleton width="100%" height={64} style={{ marginTop: 18 }} />
        </div>
      </div>
    );
  }

  if (load.status === "error") {
    return (
      <div className="scr sd" data-testid="series-detail-error">
        <DetailHeader onBack={onBack} />
        <div className="sd__body">
          <ErrorState
            title="Could not load this series"
            action={
              <Button variant="secondary" onClick={fetchDetail}>
                Try again
              </Button>
            }
          >
            {load.message}
          </ErrorState>
        </div>
      </div>
    );
  }

  const d = load.data;
  return (
    <div className="scr sd" data-testid="series-detail">
      <DetailHeader onBack={onBack} />

      <div
        className={`sd__hero ${d.hero ? "" : "sd__hero--blank"}`}
        role="img"
        aria-label={d.title ?? "Series artwork"}
        style={d.hero ? { backgroundImage: `url(${d.hero})` } : undefined}
        data-testid="series-hero"
      >
        <div className="sd__hero-grad" aria-hidden />
        <h1 className="sd__title">{d.title ?? "Untitled series"}</h1>
      </div>

      <div className="sd__body">
        <div className="sd__meta" data-testid="series-meta">
          {d.genre && <span className="sd__tag">{d.genre}</span>}
          {d.format && <span className="sd__tag">{d.format}</span>}
          <span className="sd__tag">
            {d.episodeCount} {d.episodeCount === 1 ? "episode" : "episodes"}
          </span>
          <span className="sd__tag sd__tag--gold" data-testid="series-endings">
            {d.endingsCount} {d.endingsCount === 1 ? "ending" : "endings"}
          </span>
        </div>

        <div className="sd__a11y" data-testid="series-a11y" aria-label="Accessibility">
          {d.a11y.cc && <A11yBadge kind="cc" />}
          {d.a11y.ad && <A11yBadge kind="ad" />}
          {d.a11y.sign && <A11yBadge kind="sign" />}
          {d.a11y.langs > 0 && <A11yBadge kind="lang" text={`${d.a11y.langs} LANG`} />}
        </div>

        <div className="sd__actions">
          <Button
            variant="primary"
            size="lg"
            data-testid="series-play"
            onClick={() => {
              const first = d.episodes[0];
              analytics.track("series_opened", { seriesId, props: { source: "detail_play" } });
              if (first) onPlay(first);
            }}
            disabled={d.episodes.length === 0}
          >
            Play
          </Button>
          <Button
            variant={saved ? "secondary" : "ghost"}
            aria-pressed={saved}
            data-testid="series-save"
            onClick={toggleSave}
          >
            {saved ? "Saved" : "Add to list"}
          </Button>
        </div>

        <h2 className="sd__episodes-title">Episodes</h2>
        {d.episodes.length === 0 ? (
          <EmptyState title="No episodes yet">This series has no published episodes.</EmptyState>
        ) : (
          <ul className="sd__episodes" data-testid="series-episodes">
            {d.episodes.map((ep) => (
              <li key={ep.id} className="sd__episode">
                <span className="sd__episode-num" aria-hidden>
                  {ep.number}
                </span>
                <span className="sd__episode-label">Episode {ep.number}</span>
                {ep.locked ? (
                  <button
                    type="button"
                    className="sd__episode-lock"
                    data-testid={`episode-lock-${ep.id}`}
                    onClick={() => {
                      // No dead end: the unlock intent is logged even before the unlock sheet ships.
                      analytics.track("unlock_shown", {
                        seriesId,
                        episodeId: ep.id,
                        props: { coinCost: ep.coinCost },
                      });
                    }}
                    aria-label={`Episode ${ep.number} locked, unlock for ${ep.coinCost} credits`}
                  >
                    <LockGlyph />
                    <CreditsPill amount={ep.coinCost} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="sd__episode-play"
                    data-testid={`episode-play-${ep.id}`}
                    onClick={() => {
                      analytics.track("series_opened", { seriesId, episodeId: ep.id, props: { source: "episode_row" } });
                      onPlay(ep);
                    }}
                  >
                    Play
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DetailHeader({ onBack }: { onBack: () => void }) {
  return (
    <div className="sd__topbar">
      <button type="button" className="sd__back" onClick={onBack} aria-label="Back" data-testid="series-back">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
