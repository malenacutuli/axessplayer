// 20-V4 LIBRARY (route /library). Tabs: Saved / Downloads / History, plus My Favorites (favorited
// shows + followed characters). Every tab binds to the LIBRARY API CONTRACT (authed; identity is the
// session subject, never a body field, F1) and owns its own empty / loading / error state. No dead
// ends: every control routes or emits its canonical event (unsave, favorite, character_followed,
// download_started, offline_watched, series_opened).
//
// HONEST framing (C12): a download is a fixed cut, not the live adaptive experience. The actual offline
// file is a client capability stub for now: a wifi-gated note and a Download control that POSTs
// /downloads to RECORD INTENT and flips status. We do not fake an offline player. No em dashes.

import { useCallback, useEffect, useState } from "react";
import { Button, Skeleton, EmptyState, ErrorState } from "@axessplayer/ui";
import type {
  LibraryClient,
  SavedItem,
  DownloadItem,
  HistoryItem,
  FavoriteItem,
  DownloadStatus,
} from "../api/library.js";
import type { ViewerAnalytics } from "../analytics/analytics.js";

export type LibraryTab = "saved" | "downloads" | "history" | "favorites";

export interface LibraryProps {
  library: LibraryClient;
  analytics: ViewerAnalytics;
  onBack: () => void;
  // Open a series detail route (used by saved/history/favorite show rows).
  onOpenSeries: (seriesId: string) => void;
  // Resume a watch (history "Resume" / a download "Watch offline").
  onResume: (seriesId: string) => void;
  // Optional initial tab from the query string.
  initialTab?: LibraryTab;
}

const TABS: { id: LibraryTab; label: string }[] = [
  { id: "saved", label: "Saved" },
  { id: "downloads", label: "Downloads" },
  { id: "history", label: "History" },
  { id: "favorites", label: "Favorites" },
];

export function Library({ library, analytics, onBack, onOpenSeries, onResume, initialTab = "saved" }: LibraryProps) {
  const [tab, setTab] = useState<LibraryTab>(initialTab);

  return (
    <div className="scr lib" data-testid="library">
      <div className="lib__topbar">
        <button type="button" className="sd__back" onClick={onBack} aria-label="Back" data-testid="library-back">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1 className="lib__title">Library</h1>
      </div>

      <div className="lib__tabs" role="tablist" aria-label="Library sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`lib-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`lib-panel-${t.id}`}
            className={`lib__tab ${tab === t.id ? "is-on" : ""}`}
            data-testid={`library-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        className="lib__panel"
        role="tabpanel"
        id={`lib-panel-${tab}`}
        aria-labelledby={`lib-tab-${tab}`}
        data-testid={`library-panel-${tab}`}
      >
        {tab === "saved" && <SavedTab library={library} analytics={analytics} onOpenSeries={onOpenSeries} />}
        {tab === "downloads" && <DownloadsTab library={library} analytics={analytics} onResume={onResume} />}
        {tab === "history" && <HistoryTab library={library} analytics={analytics} onResume={onResume} />}
        {tab === "favorites" && <FavoritesTab library={library} analytics={analytics} onOpenSeries={onOpenSeries} />}
      </div>
    </div>
  );
}

// ---- shared load state -----------------------------------------------------
type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

function useLibraryLoad<T>(fetcher: () => Promise<T>, deps: unknown[]): { load: Load<T>; reload: () => void; set: (d: T) => void } {
  const [load, setLoad] = useState<Load<T>>({ status: "loading" });

  const reload = useCallback(() => {
    setLoad({ status: "loading" });
    let live = true;
    void (async () => {
      try {
        const data = await fetcher();
        if (live) setLoad({ status: "ready", data });
      } catch (err) {
        if (live) setLoad({ status: "error", message: err instanceof Error ? err.message : "Could not load" });
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => reload(), [reload]);

  const set = useCallback((d: T) => setLoad({ status: "ready", data: d }), []);
  return { load, reload, set };
}

function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="lib__skeleton" aria-hidden data-testid="library-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="lib__row lib__row--sk">
          <Skeleton width={56} height={56} radius={10} />
          <div style={{ flex: 1 }}>
            <Skeleton width={160} height={14} />
            <Skeleton width={90} height={12} style={{ marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Thumb({ poster, label }: { poster: string | null; label: string }) {
  return (
    <span
      className={`lib__thumb ${poster ? "" : "lib__thumb--blank"}`}
      role="img"
      aria-label={label}
      style={poster ? { backgroundImage: `url(${poster})` } : undefined}
    />
  );
}

// ---- Saved tab -------------------------------------------------------------
function SavedTab({
  library,
  analytics,
  onOpenSeries,
}: {
  library: LibraryClient;
  analytics: ViewerAnalytics;
  onOpenSeries: (seriesId: string) => void;
}) {
  const { load, reload, set } = useLibraryLoad<SavedItem[]>(() => library.getSaved(), [library]);
  const [busy, setBusy] = useState<string | null>(null);

  const unsave = useCallback(
    async (item: SavedItem) => {
      if (busy) return;
      setBusy(item.seriesId);
      try {
        await library.unsaveSeries(item.seriesId);
        analytics.track("unsave", { seriesId: item.seriesId });
        set(await library.getSaved());
      } catch {
        // Leave the row; the next reload reconciles. The control re-enables in finally.
      } finally {
        setBusy(null);
      }
    },
    [analytics, busy, library, set],
  );

  if (load.status === "loading") return <ListSkeleton />;
  if (load.status === "error")
    return (
      <ErrorState
        title="Could not load your saved shows"
        action={
          <Button variant="secondary" onClick={reload}>
            Try again
          </Button>
        }
      >
        {load.message}
      </ErrorState>
    );
  if (load.data.length === 0)
    return <EmptyState title="Nothing saved yet">Tap Add to list on any series and it shows up here.</EmptyState>;

  return (
    <ul className="lib__list" data-testid="saved-list">
      {load.data.map((s) => (
        <li key={s.seriesId} className="lib__row">
          <button type="button" className="lib__row-open" data-testid={`saved-open-${s.seriesId}`} onClick={() => onOpenSeries(s.seriesId)}>
            <Thumb poster={s.poster} label={s.title} />
            <span className="lib__row-main">
              <span className="lib__row-title">{s.title}</span>
              <span className="lib__row-sub">Saved {formatDate(s.createdAt)}</span>
            </span>
          </button>
          <Button
            variant="ghost"
            className="lib__btn-sm"
            data-testid={`saved-unsave-${s.seriesId}`}
            disabled={busy === s.seriesId}
            onClick={() => void unsave(s)}
          >
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}

// ---- Downloads tab ---------------------------------------------------------
function DownloadsTab({
  library,
  analytics,
  onResume,
}: {
  library: LibraryClient;
  analytics: ViewerAnalytics;
  onResume: (seriesId: string) => void;
}) {
  const { load, reload, set } = useLibraryLoad<DownloadItem[]>(() => library.getDownloads(), [library]);
  const [busy, setBusy] = useState<string | null>(null);

  // Flip a download's status (the offline file is a client stub; this records the lifecycle on the server).
  const setStatus = useCallback(
    async (item: DownloadItem, status: DownloadStatus) => {
      if (busy) return;
      setBusy(item.seriesId);
      try {
        await library.setDownloadStatus(item.seriesId, status);
        set(await library.getDownloads());
      } catch {
        // best-effort; reload reconciles
      } finally {
        setBusy(null);
      }
    },
    [busy, library, set],
  );

  if (load.status === "loading") return <ListSkeleton />;
  if (load.status === "error")
    return (
      <ErrorState
        title="Could not load your downloads"
        action={
          <Button variant="secondary" onClick={reload}>
            Try again
          </Button>
        }
      >
        {load.message}
      </ErrorState>
    );

  return (
    <>
      <p className="lib__note" data-testid="downloads-note">
        A download is a fixed cut, not the live adaptive experience. Downloads use wifi and play offline as
        recorded. The offline file is a client capability we are still building.
      </p>
      {load.data.length === 0 ? (
        <EmptyState title="No downloads yet">
          Download a series from its detail page to keep a fixed cut for offline.
        </EmptyState>
      ) : (
        <ul className="lib__list" data-testid="downloads-list">
          {load.data.map((d) => (
            <li key={d.seriesId} className="lib__row">
              <Thumb poster={d.poster} label={d.title} />
              <span className="lib__row-main">
                <span className="lib__row-title">{d.title}</span>
                <span className="lib__row-sub">
                  {d.episodeIds.length} {d.episodeIds.length === 1 ? "episode" : "episodes"}
                  {d.bytes > 0 ? ` · ${formatBytes(d.bytes)}` : ""}
                </span>
                <span className={`lib__dlstatus lib__dlstatus--${d.status}`} data-testid={`download-status-${d.seriesId}`}>
                  {DOWNLOAD_STATUS_LABEL[d.status]}
                </span>
              </span>
              <div className="lib__row-actions">
                {d.status === "ready" ? (
                  <Button
                    variant="primary"
                    className="lib__btn-sm"
                    data-testid={`download-watch-${d.seriesId}`}
                    onClick={() => {
                      analytics.track("offline_watched", { seriesId: d.seriesId, props: { episodeIds: d.episodeIds } });
                      onResume(d.seriesId);
                    }}
                  >
                    Watch offline
                  </Button>
                ) : d.status === "requested" ? (
                  <span className="lib__pending" data-testid={`download-pending-${d.seriesId}`}>
                    Preparing
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    className="lib__btn-sm"
                    data-testid={`download-retry-${d.seriesId}`}
                    disabled={busy === d.seriesId}
                    onClick={() => void setStatus(d, "requested")}
                  >
                    Retry
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="lib__btn-sm"
                  data-testid={`download-remove-${d.seriesId}`}
                  disabled={busy === d.seriesId}
                  onClick={() => void setStatus(d, "expired")}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---- History tab -----------------------------------------------------------
function HistoryTab({
  library,
  analytics,
  onResume,
}: {
  library: LibraryClient;
  analytics: ViewerAnalytics;
  onResume: (seriesId: string) => void;
}) {
  const { load, reload } = useLibraryLoad<HistoryItem[]>(() => library.getHistory(), [library]);

  if (load.status === "loading") return <ListSkeleton />;
  if (load.status === "error")
    return (
      <ErrorState
        title="Could not load your history"
        action={
          <Button variant="secondary" onClick={reload}>
            Try again
          </Button>
        }
      >
        {load.message}
      </ErrorState>
    );
  if (load.data.length === 0)
    return <EmptyState title="No watch history yet">Shows you watch appear here so you can pick up where you left off.</EmptyState>;

  return (
    <ul className="lib__list" data-testid="history-list">
      {load.data.map((h, i) => (
        <li key={`${h.seriesId}-${h.episodeId ?? i}-${h.watchedAt}`} className="lib__row">
          <button
            type="button"
            className="lib__row-open"
            data-testid={`history-resume-${h.seriesId}`}
            onClick={() => {
              analytics.track("continue_resumed", { seriesId: h.seriesId, episodeId: h.episodeId ?? undefined });
              onResume(h.seriesId);
            }}
          >
            <Thumb poster={h.poster} label={h.title} />
            <span className="lib__row-main">
              <span className="lib__row-title">{h.title}</span>
              <span className="lib__row-sub">Watched {formatDate(h.watchedAt)}</span>
            </span>
            <span className="lib__resume-cue" aria-hidden>
              Resume
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---- Favorites tab (shows + followed characters) ---------------------------
function FavoritesTab({
  library,
  analytics,
  onOpenSeries,
}: {
  library: LibraryClient;
  analytics: ViewerAnalytics;
  onOpenSeries: (seriesId: string) => void;
}) {
  const { load, reload, set } = useLibraryLoad<FavoriteItem[]>(() => library.getFavorites(), [library]);
  const [busy, setBusy] = useState<string | null>(null);

  const remove = useCallback(
    async (item: FavoriteItem) => {
      const key = `${item.targetType}:${item.targetId}`;
      if (busy) return;
      setBusy(key);
      try {
        await library.removeFavorite(item.targetType, item.targetId);
        // The taxonomy has no un-favorite event; we record the canonical favorite / character_followed
        // event with state:"off" so the interaction is captured on this surface (no dead end).
        analytics.track(item.targetType === "character" ? "character_followed" : "favorite", {
          seriesId: item.targetType === "show" ? item.targetId : undefined,
          props: { targetType: item.targetType, targetId: item.targetId, state: "off" },
        });
        set(await library.getFavorites());
      } catch {
        // best-effort; reload reconciles
      } finally {
        setBusy(null);
      }
    },
    [analytics, busy, library, set],
  );

  if (load.status === "loading") return <ListSkeleton />;
  if (load.status === "error")
    return (
      <ErrorState
        title="Could not load your favorites"
        action={
          <Button variant="secondary" onClick={reload}>
            Try again
          </Button>
        }
      >
        {load.message}
      </ErrorState>
    );
  if (load.data.length === 0)
    return (
      <EmptyState title="No favorites yet">
        Favorite a show or follow a character and they collect here.
      </EmptyState>
    );

  const shows = load.data.filter((f) => f.targetType === "show");
  const characters = load.data.filter((f) => f.targetType === "character");

  return (
    <div data-testid="favorites-list">
      {shows.length > 0 && (
        <>
          <h2 className="lib__group">Shows</h2>
          <ul className="lib__list">
            {shows.map((f) => (
              <li key={`show:${f.targetId}`} className="lib__row">
                <button
                  type="button"
                  className="lib__row-open"
                  data-testid={`favorite-show-${f.targetId}`}
                  onClick={() => onOpenSeries(f.targetId)}
                >
                  <Thumb poster={f.poster} label={f.title} />
                  <span className="lib__row-main">
                    <span className="lib__row-title">{f.title}</span>
                    {f.subtitle && <span className="lib__row-sub">{f.subtitle}</span>}
                  </span>
                </button>
                <FavoriteToggle
                  label="show"
                  busy={busy === `show:${f.targetId}`}
                  testId={`favorite-unfollow-show-${f.targetId}`}
                  onRemove={() => void remove(f)}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {characters.length > 0 && (
        <>
          <h2 className="lib__group">Characters you follow</h2>
          <ul className="lib__list">
            {characters.map((f) => (
              <li key={`character:${f.targetId}`} className="lib__row">
                <span className="lib__row-open lib__row-open--static">
                  <span
                    className={`lib__thumb lib__thumb--round ${f.poster ? "" : "lib__thumb--blank"}`}
                    role="img"
                    aria-label={f.title}
                    style={f.poster ? { backgroundImage: `url(${f.poster})` } : undefined}
                  />
                  <span className="lib__row-main">
                    <span className="lib__row-title">{f.title}</span>
                    {f.subtitle && <span className="lib__row-sub">{f.subtitle}</span>}
                  </span>
                </span>
                <FavoriteToggle
                  label="character"
                  busy={busy === `character:${f.targetId}`}
                  testId={`favorite-unfollow-character-${f.targetId}`}
                  onRemove={() => void remove(f)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function FavoriteToggle({
  label,
  busy,
  testId,
  onRemove,
}: {
  label: string;
  busy: boolean;
  testId: string;
  onRemove: () => void;
}) {
  return (
    <Button variant="ghost" className="lib__btn-sm" data-testid={testId} disabled={busy} aria-label={`Unfollow this ${label}`} onClick={onRemove}>
      Following
    </Button>
  );
}

// ---- formatting helpers ----------------------------------------------------
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

// Honest, readable download lifecycle labels (the offline file is a client stub; these reflect the
// server-recorded intent, not a real package).
const DOWNLOAD_STATUS_LABEL: Record<DownloadStatus, string> = {
  requested: "Preparing",
  ready: "Ready offline",
  expired: "Expired",
  failed: "Failed",
};
