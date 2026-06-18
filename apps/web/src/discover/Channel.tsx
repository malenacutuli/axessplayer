// 20-V2 CHANNELS: channel detail (route /channel/:id). GET /channel/:id gives the hero, "N shows", a
// Follow button + notification bell toggling POST/DELETE /channel-follows (with notify), and a
// "Most loved" series list with rating, episode count, and accessibility badges. Follow + bell persist:
// the follow state is read back from GET /channel-follows so a re-fetch reflects the server. Every
// surface owns its loading (Skeleton), empty, and error state. No dead ends: each series row opens its
// detail route and emits series_opened; following emits channel_followed. No em dashes.

import { useCallback, useEffect, useState } from "react";
import { A11yBadge, Button, Skeleton, EmptyState, ErrorState } from "@axessplayer/ui";
import type { CatalogClient, ChannelDetail } from "../api/catalog.js";
import type { LibraryClient } from "../api/library.js";
import type { ViewerAnalytics } from "../analytics/analytics.js";

export interface ChannelProps {
  channelId: string;
  catalog: CatalogClient;
  library: LibraryClient;
  analytics: ViewerAnalytics;
  onBack: () => void;
  onOpenSeries: (seriesId: string) => void;
}

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: ChannelDetail };
type FollowState = { following: boolean; notify: boolean };

export function Channel({ channelId, catalog, library, analytics, onBack, onOpenSeries }: ChannelProps) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  // Follow + bell. Read back from GET /channel-follows so the control reflects the persisted server state.
  const [follow, setFollow] = useState<FollowState>({ following: false, notify: false });
  const [followBusy, setFollowBusy] = useState(false);

  const fetchAll = useCallback(() => {
    setLoad({ status: "loading" });
    let live = true;
    void (async () => {
      try {
        const data = await catalog.getChannel(channelId);
        if (live) setLoad({ status: "ready", data });
      } catch (err) {
        if (live) setLoad({ status: "error", message: err instanceof Error ? err.message : "Could not load" });
      }
    })();
    // Hydrate the follow state from the server. A failure here leaves the control in its default
    // (not following); it never blocks the page.
    void (async () => {
      try {
        const follows = await library.getChannelFollows();
        const mine = follows.find((c) => c.channelId === channelId);
        if (live) setFollow({ following: Boolean(mine), notify: mine?.notify ?? false });
      } catch {
        // best-effort
      }
    })();
    return () => {
      live = false;
    };
  }, [catalog, library, channelId]);

  useEffect(() => fetchAll(), [fetchAll]);

  // Follow / unfollow. Optimistic, then re-fetch the follow state so the UI reflects what persisted.
  const toggleFollow = useCallback(async () => {
    if (followBusy) return;
    setFollowBusy(true);
    const next = !follow.following;
    const nextNotify = next ? follow.notify : false;
    setFollow({ following: next, notify: nextNotify });
    try {
      if (next) {
        await library.followChannel(channelId, follow.notify);
        analytics.track("channel_followed", { props: { channelId, notify: follow.notify } });
      } else {
        await library.unfollowChannel(channelId);
      }
      const follows = await library.getChannelFollows();
      const mine = follows.find((c) => c.channelId === channelId);
      setFollow({ following: Boolean(mine), notify: mine?.notify ?? false });
    } catch {
      // Roll back on failure so the control never lies about the persisted state.
      setFollow({ following: !next, notify: follow.notify });
    } finally {
      setFollowBusy(false);
    }
  }, [analytics, channelId, follow, followBusy, library]);

  // The bell toggles notify on an existing follow. It re-POSTs the follow with the new notify flag
  // (POST /channel-follows is an upsert per the contract), then re-reads to confirm persistence.
  const toggleNotify = useCallback(async () => {
    if (followBusy || !follow.following) return;
    setFollowBusy(true);
    const nextNotify = !follow.notify;
    setFollow((prev) => ({ ...prev, notify: nextNotify }));
    try {
      await library.followChannel(channelId, nextNotify);
      const follows = await library.getChannelFollows();
      const mine = follows.find((c) => c.channelId === channelId);
      setFollow({ following: Boolean(mine), notify: mine?.notify ?? false });
    } catch {
      setFollow((prev) => ({ ...prev, notify: !nextNotify }));
    } finally {
      setFollowBusy(false);
    }
  }, [channelId, follow.following, follow.notify, followBusy, library]);

  if (load.status === "loading") {
    return (
      <div className="scr chn" data-testid="channel-loading">
        <ChannelHeader onBack={onBack} />
        <Skeleton width="100%" height={200} radius={0} />
        <div className="chn__body">
          <Skeleton width={180} height={24} />
          <Skeleton width={120} height={14} style={{ marginTop: 10 }} />
          <Skeleton width="100%" height={72} style={{ marginTop: 18 }} />
        </div>
      </div>
    );
  }

  if (load.status === "error") {
    return (
      <div className="scr chn" data-testid="channel-error">
        <ChannelHeader onBack={onBack} />
        <div className="chn__body">
          <ErrorState
            title="Could not load this channel"
            action={
              <Button variant="secondary" onClick={fetchAll}>
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
    <div className="scr chn" data-testid="channel">
      <ChannelHeader onBack={onBack} />

      <div
        className={`chn__hero ${d.heroUrl ? "" : "chn__hero--blank"}`}
        role="img"
        aria-label={d.name}
        style={d.heroUrl ? { backgroundImage: `url(${d.heroUrl})` } : undefined}
        data-testid="channel-hero"
      >
        <div className="chn__hero-grad" aria-hidden />
        <h1 className="chn__title">{d.name}</h1>
      </div>

      <div className="chn__body">
        <div className="chn__head">
          <span className="chn__count" data-testid="channel-count">
            {d.showCount} {d.showCount === 1 ? "show" : "shows"}
          </span>
          <div className="chn__follow">
            <Button
              variant={follow.following ? "secondary" : "primary"}
              aria-pressed={follow.following}
              data-testid="channel-follow"
              disabled={followBusy}
              onClick={() => void toggleFollow()}
            >
              {follow.following ? "Following" : "Follow"}
            </Button>
            <button
              type="button"
              className={`chn__bell ${follow.notify ? "is-on" : ""}`}
              aria-pressed={follow.notify}
              aria-label={follow.notify ? "Turn off notifications" : "Turn on notifications"}
              data-testid="channel-bell"
              disabled={followBusy || !follow.following}
              onClick={() => void toggleNotify()}
            >
              <BellGlyph on={follow.notify} />
            </button>
          </div>
        </div>

        <h2 className="chn__section-title">Most loved</h2>
        {d.series.length === 0 ? (
          <EmptyState title="No shows here yet">
            This channel has no published series yet. Follow to be notified when new series land.
          </EmptyState>
        ) : (
          <ul className="chn__series" data-testid="channel-series">
            {d.series.map((s) => (
              <li key={s.seriesId} className="chn__series-row">
                <button
                  type="button"
                  className="chn__series-btn"
                  data-testid={`channel-series-${s.seriesId}`}
                  onClick={() => {
                    analytics.track("series_opened", { seriesId: s.seriesId, props: { source: "channel" } });
                    onOpenSeries(s.seriesId);
                  }}
                >
                  <span
                    className={`chn__series-poster ${s.poster ? "" : "chn__series-poster--blank"}`}
                    role="img"
                    aria-label={s.title}
                    style={s.poster ? { backgroundImage: `url(${s.poster})` } : undefined}
                  />
                  <span className="chn__series-main">
                    <span className="chn__series-title">{s.title}</span>
                    <span className="chn__series-meta">
                      {s.rating != null && (
                        <span className="chn__series-rating" aria-label={`Rated ${s.rating} out of 5`}>
                          <StarGlyph /> {s.rating.toFixed(1)}
                        </span>
                      )}
                      <span>
                        {s.episodes} {s.episodes === 1 ? "episode" : "episodes"}
                      </span>
                    </span>
                    <span className="chn__series-a11y" aria-label="Accessibility">
                      {s.badges.cc && <A11yBadge kind="cc" />}
                      {s.badges.ad && <A11yBadge kind="ad" />}
                      {s.badges.sign && <A11yBadge kind="sign" />}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ChannelHeader({ onBack }: { onBack: () => void }) {
  return (
    <div className="sd__topbar">
      <button type="button" className="sd__back" onClick={onBack} aria-label="Back" data-testid="channel-back">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

function BellGlyph({ on }: { on: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} aria-hidden>
      <path
        d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StarGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3 5.8 20.9l1.6-6.8L2.2 8.9l6.9-.6L12 2z" />
    </svg>
  );
}
