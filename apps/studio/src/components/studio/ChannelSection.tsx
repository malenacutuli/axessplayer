// SECTION 13 - CHANNEL (/studio/channel). A branded channel page: the series grid, an about block, the
// follower count, and links, built from GET /channels (the picker) + GET /channel/:id (the page). Channel-
// level analytics come from GET /channel/:id/analytics (followers, follower trend drawn as a band-free
// sparkline with an accessible table mirror, series performance, and the notification-bell audience).
// Channel-level brand deals are empty / coming-soon (the brand tables are not in the hosted schema yet, so
// brandDeals arrives empty and we render a real empty surface, never fabricated deals). Edit-channel is an
// RBAC and confirmation-gated seam: the write endpoint is unbuilt, so editing is a gated coming-soon affordance.
//
// Any catalog route may be undeployed in an environment: a 404/501 degrades to a graceful "not connected"
// state, never a dead end. Built on @axessplayer/ui (STUDIO skin). WCAG 2.2 AA. No emojis, no em dashes.
import { useMemo, useState } from "react";
import { A11yBadge, Button, EmptyState, ErrorState, KpiCard, Skeleton } from "@axessplayer/ui";
import { useChannels, useChannelDetail, useChannelAnalytics } from "../../api/useCatalog.js";
import type {
  ChannelAnalytics,
  ChannelDetail,
  ChannelSummary,
  FollowerTrendPoint,
} from "../../api/catalogTypes.js";

export function ChannelSection(): JSX.Element {
  const [channelId, setChannelId] = useState("");

  return (
    <div className="spanel" data-testid="panel-channel">
      <div className="sbar">
        <div>
          <div className="ey rose">Channel</div>
          <h2 style={{ marginTop: 8 }}>Your branded channel</h2>
          <p className="muted">Your public channel page, series grid, followers, links, and channel-level analytics.</p>
        </div>
      </div>

      <ChannelPicker selectedId={channelId} onSelect={setChannelId} />

      {!channelId && (
        <p className="muted" data-testid="channel-idle" style={{ marginTop: 12 }}>
          Pick a channel to see its page, followers, and analytics.
        </p>
      )}

      {channelId && (
        <>
          <ChannelPage channelId={channelId} />
          <ChannelAnalyticsPanel channelId={channelId} />
        </>
      )}
    </div>
  );
}

// The channel picker reads GET /channels. A 404/501 degrades to "not connected"; an empty list is a real
// empty state. Mirrors the SeriesPicker shape so the section never dead-ends.
function ChannelPicker({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }): JSX.Element {
  const [reload, setReload] = useState(0);
  const state = useChannels(reload);

  if (state.status === "loading" || state.status === "idle") {
    return <Skeleton height={48} data-testid="channel-picker-loading" />;
  }
  if (state.status === "error") {
    return (
      <div className="statusline err" role="alert" data-testid="channel-picker-error">
        {state.notAvailable
          ? "The channels service is not connected in this environment yet."
          : `Could not load channels: ${state.message}`}
        <button type="button" className="btn" style={{ marginLeft: 8 }} onClick={() => setReload((n) => n + 1)} data-testid="channel-picker-retry">
          Retry
        </button>
      </div>
    );
  }
  if (state.data.length === 0) {
    return (
      <p className="muted" data-testid="channel-picker-empty">
        No channels yet. A channel groups your series into a branded page.
      </p>
    );
  }
  return (
    <div className="fld">
      <label htmlFor="channel-picker">Choose a channel</label>
      <select id="channel-picker" value={selectedId} onChange={(e) => onSelect(e.target.value)} data-testid="channel-picker">
        <option value="">Select a channel</option>
        {state.data.map((c: ChannelSummary) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.showCount} {c.showCount === 1 ? "show" : "shows"})
          </option>
        ))}
      </select>
    </div>
  );
}

function ChannelPage({ channelId }: { channelId: string }): JSX.Element {
  const [reload, setReload] = useState(0);
  const state = useChannelDetail(channelId, reload);

  return (
    <section aria-label="Channel page" data-testid="channel-page" style={{ marginTop: 16 }}>
      {state.status === "loading" && (
        <div aria-busy="true" data-testid="channel-page-loading">
          <Skeleton height={120} />
          <Skeleton height={180} style={{ marginTop: 10 }} />
        </div>
      )}
      {state.status === "error" && state.notAvailable && (
        <EmptyState
          title="The channel page is not connected here"
          action={<Button variant="secondary" onClick={() => setReload((n) => n + 1)} data-testid="channel-page-retry">Try again</Button>}
        >
          <p className="muted" data-testid="channel-page-not-available">
            The catalog channel service is not reachable in this environment yet.
          </p>
        </EmptyState>
      )}
      {state.status === "error" && !state.notAvailable && (
        <ErrorState
          title="Could not load the channel"
          action={<Button variant="secondary" onClick={() => setReload((n) => n + 1)} data-testid="channel-page-retry">Retry</Button>}
        >
          <p className="muted" data-testid="channel-page-error">{state.message}</p>
        </ErrorState>
      )}
      {state.status === "loaded" && <ChannelPageBody data={state.data} />}
    </section>
  );
}

function ChannelPageBody({ data }: { data: ChannelDetail }): JSX.Element {
  return (
    <div data-testid="channel-page-body">
      <div className="channel-hero">
        {data.heroUrl ? (
          <img className="channel-hero__art" src={data.heroUrl} alt="" />
        ) : (
          <div className="channel-hero__art channel-hero__art--empty" aria-hidden />
        )}
        <div className="channel-hero__meta">
          <h3 className="channel-hero__name">{data.name}</h3>
          <p className="muted">{data.showCount} {data.showCount === 1 ? "series" : "series"} on this channel</p>
        </div>
        <EditChannelGate channelName={data.name} />
      </div>

      <div className="scaption" style={{ marginTop: 16 }}>Series</div>
      {data.series.length === 0 ? (
        <p className="muted" data-testid="channel-series-empty">No series mapped to this channel yet.</p>
      ) : (
        <ul className="poster-grid" data-testid="channel-series">
          {data.series.map((s) => (
            <li key={s.seriesId} className="poster-card" data-testid={`channel-series-${s.seriesId}`}>
              {s.poster ? (
                <img className="poster-thumb" src={s.poster} alt="" />
              ) : (
                <div className="poster-thumb" aria-hidden />
              )}
              <div className="poster-card__meta">
                <b>{s.title}</b>
                <span className="muted">{s.episodes} {s.episodes === 1 ? "episode" : "episodes"} - rating {s.rating.toFixed(1)}</span>
                <span className="brand-badge-row">
                  {s.badges.cc && <A11yBadge kind="cc" />}
                  {s.badges.ad && <A11yBadge kind="ad" />}
                  {s.badges.sign && <A11yBadge kind="sign" />}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ChannelLinks />
    </div>
  );
}

// Edit-channel is an RBAC and confirmation-gated seam: the write endpoint is unbuilt. The control is shown
// (no dead end) but explains it is gated, so the surface is honest about the capability not being live.
function EditChannelGate({ channelName }: { channelName: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="channel-hero__edit">
      <Button variant="secondary" onClick={() => setOpen((v) => !v)} data-testid="channel-edit">
        Edit channel
      </Button>
      {open && (
        <p className="muted" role="status" data-testid="channel-edit-gated" style={{ marginTop: 6, maxWidth: 280 }}>
          Editing {channelName} (name, art, about, links) is permission-gated and confirmation-gated. The
          channel write endpoint is not built yet, so no change is saved here (gated).
        </p>
      )}
    </div>
  );
}

// Channel links are a display-only "about / links" block. There is no channel-links write endpoint yet, so
// the links shown are the canonical share path for the channel page, not editable here.
function ChannelLinks(): JSX.Element {
  return (
    <div className="inspcard" data-testid="channel-links" style={{ marginTop: 16 }}>
      <div className="scaption">About and links</div>
      <p className="muted">
        Your about copy and external links live on the public channel page. Editing them is part of the
        permission-gated edit-channel seam above.
      </p>
    </div>
  );
}

function ChannelAnalyticsPanel({ channelId }: { channelId: string }): JSX.Element {
  const [reload, setReload] = useState(0);
  const state = useChannelAnalytics(channelId, reload);

  return (
    <section aria-label="Channel analytics" data-testid="channel-analytics" style={{ marginTop: 18 }}>
      <div className="scaption">Channel analytics</div>
      {state.status === "loading" && (
        <div aria-busy="true" data-testid="channel-analytics-loading">
          <Skeleton height={64} />
          <Skeleton height={120} style={{ marginTop: 10 }} />
        </div>
      )}
      {state.status === "error" && state.notAvailable && (
        <EmptyState
          title="Channel analytics are not connected here"
          action={<Button variant="secondary" onClick={() => setReload((n) => n + 1)} data-testid="channel-analytics-retry">Try again</Button>}
        >
          <p className="muted" data-testid="channel-analytics-not-available">
            The catalog channel-analytics route is not reachable in this environment yet.
          </p>
        </EmptyState>
      )}
      {state.status === "error" && !state.notAvailable && (
        <ErrorState
          title="Could not load channel analytics"
          action={<Button variant="secondary" onClick={() => setReload((n) => n + 1)} data-testid="channel-analytics-retry">Retry</Button>}
        >
          <p className="muted" data-testid="channel-analytics-error">{state.message}</p>
        </ErrorState>
      )}
      {state.status === "loaded" && <ChannelAnalyticsBody data={state.data} />}
    </section>
  );
}

function ChannelAnalyticsBody({ data }: { data: ChannelAnalytics }): JSX.Element {
  return (
    <div data-testid="channel-analytics-body">
      <div className="analytics-kpis" data-testid="channel-analytics-kpis">
        <KpiCard label="Followers" value={data.followers.toLocaleString()} tone="neutral" />
        <KpiCard label="Notification audience" value={data.notificationAudience.toLocaleString()} tone="neutral" trend="bell subscribers" />
      </div>

      <FollowerTrend points={data.followerTrend} />
      <SeriesPerformance data={data} />
      <ChannelBrandDeals data={data} />
    </div>
  );
}

// The follower trend, drawn as an SVG sparkline with an accessible table mirror so the line is not the only
// carrier of the information (WCAG). No band here (this is an observed count, not a counterfactual).
function FollowerTrend({ points }: { points: FollowerTrendPoint[] }): JSX.Element {
  const W = 560;
  const H = 120;
  const padX = 24;
  const padY = 12;
  const { path, max, min } = useMemo(() => {
    if (points.length === 0) return { path: "", max: 0, min: 0 };
    const vals = points.map((p) => p.followers);
    const mx = Math.max(...vals);
    const mn = Math.min(...vals);
    const innerW = W - padX * 2;
    const innerH = H - padY * 2;
    const span = mx - mn || 1;
    const d = points
      .map((p, i) => {
        const x = padX + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
        const y = padY + (1 - (p.followers - mn) / span) * innerH;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
    return { path: d, max: mx, min: mn };
  }, [points]);

  return (
    <div data-testid="channel-follower-trend" style={{ marginTop: 14 }}>
      <div className="scaption">Follower trend</div>
      {points.length === 0 ? (
        <p className="muted" data-testid="channel-trend-empty">No follower history yet.</p>
      ) : (
        <>
          <svg
            className="analytics-curve"
            width="100%"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Followers range from ${min.toLocaleString()} to ${max.toLocaleString()} across ${points.length} periods.`}
            data-testid="channel-trend-curve"
          >
            <path d={path} fill="none" stroke="var(--rose)" strokeWidth={2.5} />
          </svg>
          <table className="analytics-table" data-testid="channel-trend-table">
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Followers</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.period} data-testid={`channel-trend-${slug(p.period)}`}>
                  <td>{p.period}</td>
                  <td>{p.followers.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function SeriesPerformance({ data }: { data: ChannelAnalytics }): JSX.Element {
  return (
    <div data-testid="channel-series-performance" style={{ marginTop: 16 }}>
      <div className="scaption">Series performance</div>
      {data.seriesPerformance.length === 0 ? (
        <p className="muted" data-testid="channel-series-performance-empty">No series performance yet.</p>
      ) : (
        <table className="analytics-table">
          <thead>
            <tr>
              <th scope="col">Series</th>
              <th scope="col">Views</th>
              <th scope="col">Completion</th>
            </tr>
          </thead>
          <tbody>
            {data.seriesPerformance.map((s) => (
              <tr key={s.seriesId} data-testid={`channel-series-perf-${s.seriesId}`}>
                <td>{s.title}</td>
                <td>{s.views.toLocaleString()}</td>
                <td>{Math.round(s.completion * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Channel-level brand deals. The brand tables are not in the hosted schema yet, so brandDeals arrives empty
// in every current environment and we render a real empty / coming-soon surface, never fabricated deals.
function ChannelBrandDeals({ data }: { data: ChannelAnalytics }): JSX.Element {
  return (
    <div data-testid="channel-brand-deals" style={{ marginTop: 16 }}>
      <div className="scaption">Channel brand deals</div>
      {data.brandDeals.length === 0 ? (
        <EmptyState title="No channel brand deals yet">
          <p className="muted" data-testid="channel-brand-deals-empty">
            Channel-level brand deals appear here once the brand service is connected. They follow the same
            opt-in permission model and content/ad firewall as the brand offers inbox.
          </p>
        </EmptyState>
      ) : (
        <table className="analytics-table" data-testid="channel-brand-deals-table">
          <thead>
            <tr>
              <th scope="col">Brand</th>
              <th scope="col">Status</th>
              <th scope="col">Revenue (coins)</th>
            </tr>
          </thead>
          <tbody>
            {data.brandDeals.map((d) => (
              <tr key={d.id} data-testid={`channel-brand-deal-${d.id}`}>
                <td>{d.brand}</td>
                <td>{d.status}</td>
                <td>{d.revenueCoins.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}
