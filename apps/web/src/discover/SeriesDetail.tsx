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
import type { LibraryClient } from "../api/library.js";
import type { ViewerAnalytics } from "../analytics/analytics.js";

export interface SeriesDetailProps {
  seriesId: string;
  catalog: CatalogClient;
  // 20-V4: the save control writes to POST /saved and reads its state back from GET /saved so the
  // "Add to list" / "Saved" toggle reflects what persisted (the Library Saved tab is the same source).
  library: LibraryClient;
  analytics: ViewerAnalytics;
  onBack: () => void;
  // Open the live adaptive player on this series (Play / unlocked episode).
  onPlay: (episode: SeriesEpisode) => void;
}

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: SeriesDetailData };

export function SeriesDetail({ seriesId, catalog, library, analytics, onBack, onPlay }: SeriesDetailProps) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [saved, setSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  // Download is an INTENT record (C12): a download is a fixed cut, not the live adaptive experience, and
  // the offline file itself is a client capability we are still building. This control POSTs /downloads to
  // record the intent and flips status; it does not fake an offline player.
  const [downloadState, setDownloadState] = useState<"idle" | "busy" | "requested">("idle");

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
    // Hydrate the saved state from the server so the toggle reflects what persisted. Best-effort: a
    // failure leaves the control in its default (not saved) and never blocks the page.
    void (async () => {
      try {
        const items = await library.getSaved();
        if (live) setSaved(items.some((s) => s.seriesId === seriesId));
      } catch {
        // best-effort
      }
    })();
    return () => {
      live = false;
    };
  }, [catalog, library, seriesId]);

  useEffect(() => fetchDetail(), [fetchDetail]);

  // Add-to-list, persisted via POST /saved (or DELETE /saved/:id). Optimistic, then re-read from the
  // server so the control never lies about the persisted state. Save / unsave are the canonical events.
  const toggleSave = useCallback(async () => {
    if (saveBusy) return;
    setSaveBusy(true);
    const next = !saved;
    setSaved(next);
    try {
      if (next) {
        await library.saveSeries(seriesId);
        analytics.track("save", { seriesId });
      } else {
        await library.unsaveSeries(seriesId);
        analytics.track("unsave", { seriesId });
      }
      const items = await library.getSaved();
      setSaved(items.some((s) => s.seriesId === seriesId));
    } catch {
      // Roll back on failure.
      setSaved(!next);
    } finally {
      setSaveBusy(false);
    }
  }, [analytics, library, saveBusy, saved, seriesId]);

  // Record download intent. Posts the current episode ids (a fixed cut) to /downloads and emits the
  // canonical download_started event. The actual offline packaging is a client stub for now.
  const requestDownload = useCallback(
    async (episodeIds: string[]) => {
      if (downloadState !== "idle") return;
      setDownloadState("busy");
      try {
        await library.startDownload(seriesId, episodeIds);
        analytics.track("download_started", { seriesId, props: { episodeIds } });
        setDownloadState("requested");
      } catch {
        setDownloadState("idle");
      }
    },
    [analytics, downloadState, library, seriesId],
  );

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
            disabled={saveBusy}
            onClick={() => void toggleSave()}
          >
            {saved ? "Saved" : "Add to list"}
          </Button>
          <Button
            variant="ghost"
            data-testid="series-download"
            disabled={downloadState !== "idle" || d.episodes.length === 0}
            onClick={() => void requestDownload(d.episodes.map((e) => e.id))}
          >
            {downloadState === "requested" ? "Download queued" : "Download"}
          </Button>
        </div>
        <p className="sd__download-note" data-testid="series-download-note">
          A download is a fixed cut, not the live adaptive experience. Downloads use wifi; find them under
          Library, Downloads.
        </p>

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
