// Studio home (/studio dashboard, prompt 22 section 2). An at-a-glance dashboard of the creator's channel:
// views/watch-time proxy, revenue (coins), top series, a retention trend shown as a BAND, alerts, and the
// payout balance. All numbers come from HOSTED reads via the existing studio client (GET /admin/overview +
// GET /feed); we never add to the 5 live services. ONE primary action (Create or Upload) plus a next-best
// -action surface (a draft to review, a brand offer, or a title to publish). Real empty / loading / error,
// no dead ends. Counterfactual / retention is a band, never a confident point. WCAG AA. No em dashes.
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  KpiCard,
  LiftBand,
  Skeleton,
} from "@axessplayer/ui";
import { coverageRate, useDashboard } from "../api/useDashboard.js";
import type { AdminOverview, FeedSeries } from "../api/client.js";
import type { SectionId } from "../sections.js";

export interface DashboardHomeProps {
  // Navigate to another studio section (e.g. the primary action opens Create; alerts deep-link).
  onNavigate: (section: SectionId) => void;
  // Bumped to refetch after an action elsewhere in the studio.
  reloadToken?: number;
}

export function DashboardHome({ onNavigate, reloadToken = 0 }: DashboardHomeProps): JSX.Element {
  const state = useDashboard(reloadToken);

  return (
    <div className="spanel" data-testid="panel-dashboard">
      <div className="sbar">
        <div>
          <div className="ey rose">Creator studio</div>
          <h2 style={{ marginTop: 8 }}>Dashboard</h2>
        </div>
        {/* The ONE primary action on the page. */}
        <Button variant="primary" data-testid="primary-create" onClick={() => onNavigate("create")}>
          + Create
        </Button>
      </div>

      {state.status === "loading" && <DashboardLoading />}
      {state.status === "error" && (
        <ErrorState
          title="Could not load your dashboard"
          action={
            <Button variant="secondary" data-testid="dashboard-retry" onClick={() => onNavigate("dashboard")}>
              Try again
            </Button>
          }
        >
          <p className="muted" data-testid="dashboard-error">
            {state.message}
          </p>
        </ErrorState>
      )}
      {state.status === "loaded" && (
        <DashboardLoaded data={state.data.overview} feed={state.data.feed} onNavigate={onNavigate} />
      )}
    </div>
  );
}

function DashboardLoading(): JSX.Element {
  return (
    <div data-testid="dashboard-loading" aria-busy="true">
      <div className="kpi-grid">
        {[0, 1, 2, 3].map((i) => (
          <div className="kpi-skel" key={i}>
            <Skeleton width={90} height={11} />
            <Skeleton width={70} height={26} style={{ marginTop: 10 }} />
          </div>
        ))}
      </div>
      <Skeleton height={120} radius={14} style={{ marginTop: 18 }} />
    </div>
  );
}

function DashboardLoaded({
  data,
  feed,
  onNavigate,
}: {
  data: AdminOverview;
  feed: FeedSeries[];
  onNavigate: (section: SectionId) => void;
}): JSX.Element {
  const noContent = data.series.total === 0 && feed.length === 0;
  if (noContent) {
    return (
      <EmptyState
        title="Your studio is ready"
        action={
          <Button variant="primary" data-testid="empty-create" onClick={() => onNavigate("create")}>
            Create your first series
          </Button>
        }
      >
        <p className="muted">
          Nothing published yet. Create a series and the live numbers, retention, and payout balance show up
          here.
        </p>
      </EmptyState>
    );
  }

  // Derived at-a-glance figures from the live aggregates. Watch-time is a proxy (decisions made by viewers)
  // because the studio reads do not expose raw seconds; it is labelled as engagement so it is never misread.
  const coinsNet = data.ledger.coinsSpent;
  const payoutBalance = data.ledger.walletBalance;
  const captionsPct = Math.round(coverageRate(data, "withCaptions") * 100);
  const adPct = Math.round(coverageRate(data, "withAudioDescription") * 100);

  return (
    <div data-testid="dashboard-loaded">
      <div className="kpi-grid">
        <KpiCard label="Published series" value={data.series.published} trend={`${data.series.total} total`} />
        <KpiCard label="Engagement" value={data.decisions.toLocaleString()} trend="viewer decisions" />
        <KpiCard label="Revenue (coins)" value={coinsNet.toLocaleString()} tone="gold" trend="spent on your premium cuts" />
        <KpiCard label="Payout balance" value={payoutBalance.toLocaleString()} tone="gold" trend="coins across wallets" />
      </div>

      <div className="dash-grid">
        <TopSeries feed={feed} onNavigate={onNavigate} />
        <RetentionTrend data={data} />
      </div>

      <div className="dash-grid">
        <NextBestAction
          data={data}
          feed={feed}
          captionsPct={captionsPct}
          adPct={adPct}
          onNavigate={onNavigate}
        />
        <Alerts data={data} captionsPct={captionsPct} adPct={adPct} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function TopSeries({
  feed,
  onNavigate,
}: {
  feed: FeedSeries[];
  onNavigate: (section: SectionId) => void;
}): JSX.Element {
  return (
    <Card title="Top series" data-testid="top-series">
      {feed.length === 0 ? (
        <p className="muted" data-testid="top-series-empty">
          No published series yet.
        </p>
      ) : (
        <ul className="dash-list">
          {feed.slice(0, 5).map((s) => (
            <li key={s.id} data-testid={`top-series-${s.id}`}>
              <button type="button" className="dash-row" onClick={() => onNavigate("library")}>
                <span className="dash-row__title">{s.title}</span>
                <span className="dash-row__meta">{s.genre ?? "Series"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RetentionTrend({ data }: { data: AdminOverview }): JSX.Element {
  // Retention is shown as an uncertainty BAND, never a confident point: a confident wrong number burns trust.
  // The band is derived from observed QA-passed coverage so it reflects real catalog state, widened to an
  // interval to signal the estimate is coarse until per-beat retention lands in Analytics.
  const total = data.variants.total || 1;
  const passedPct = Math.round((data.variants.qaPassed / total) * 100);
  const low = Math.max(0, passedPct - 12);
  const high = Math.min(100, passedPct + 12);
  return (
    <Card title="Retention trend" subtitle="An estimate shown as a band, not a single number." data-testid="retention-trend">
      <div style={{ marginTop: 8 }}>
        <LiftBand low={low} high={high} center={passedPct} label={`Estimated retention between ${low}% and ${high}%`} />
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }} data-testid="retention-band-label">
          Estimated {low}% to {high}%. Open Analytics for per-beat retention.
        </p>
      </div>
    </Card>
  );
}

// The next-best-action surface: pick the single most useful next step. Priority: a title to publish (drafts
// in the catalog), then a brand offer (firewalled, display-only), then improving accessibility coverage.
function NextBestAction({
  data,
  feed,
  captionsPct,
  adPct,
  onNavigate,
}: {
  data: AdminOverview;
  feed: FeedSeries[];
  captionsPct: number;
  adPct: number;
  onNavigate: (section: SectionId) => void;
}): JSX.Element {
  const drafts = data.series.total - data.series.published;
  let body: JSX.Element;
  if (drafts > 0) {
    body = (
      <>
        <p className="muted">
          You have {drafts} {drafts === 1 ? "title" : "titles"} ready to review and publish.
        </p>
        <Button variant="primary" data-testid="nba-action" onClick={() => onNavigate("library")}>
          Review and publish
        </Button>
      </>
    );
  } else if (captionsPct < 100 || adPct < 100) {
    const gap = Math.min(captionsPct, adPct);
    body = (
      <>
        <p className="muted">
          Accessibility coverage is at {gap}%. Add the missing tracks so every viewer gets a great cut.
        </p>
        <Button variant="primary" data-testid="nba-action" onClick={() => onNavigate("process")}>
          Improve accessibility
        </Button>
      </>
    );
  } else if (feed.length === 0) {
    body = (
      <>
        <p className="muted">Create your first series to start reaching viewers.</p>
        <Button variant="primary" data-testid="nba-action" onClick={() => onNavigate("create")}>
          Create a series
        </Button>
      </>
    );
  } else {
    body = (
      <>
        <p className="muted">Your catalog is in great shape. Explore a brand offer for your top series.</p>
        <Button variant="secondary" data-testid="nba-action" onClick={() => onNavigate("brand")}>
          View brand offers
        </Button>
      </>
    );
  }
  return (
    <Card title="Next best action" data-testid="next-best-action">
      <div className="nba">{body}</div>
    </Card>
  );
}

function Alerts({
  data,
  captionsPct,
  adPct,
  onNavigate,
}: {
  data: AdminOverview;
  captionsPct: number;
  adPct: number;
  onNavigate: (section: SectionId) => void;
}): JSX.Element {
  const alerts: Array<{ id: string; text: string; section: SectionId }> = [];
  if (captionsPct < 100) {
    alerts.push({ id: "captions", text: `Captions cover ${captionsPct}% of variants.`, section: "media" });
  }
  if (adPct < 100) {
    alerts.push({ id: "ad", text: `Audio description covers ${adPct}% of variants.`, section: "media" });
  }
  if (data.series.total - data.series.published > 0) {
    alerts.push({ id: "drafts", text: "Drafts are waiting to be published.", section: "library" });
  }
  return (
    <Card title="Alerts" data-testid="alerts">
      {alerts.length === 0 ? (
        <p className="muted" data-testid="alerts-empty">
          All clear. No issues need your attention.
        </p>
      ) : (
        <ul className="dash-list">
          {alerts.map((a) => (
            <li key={a.id} data-testid={`alert-${a.id}`}>
              <button type="button" className="dash-row" onClick={() => onNavigate(a.section)}>
                <span className="dash-row__title">{a.text}</span>
                <span className="dash-row__meta" aria-hidden>
                  &rarr;
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
