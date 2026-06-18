// DASHBOARD (/admin/dashboard). KPI cards (users, DAU/WAU/MAU, watch starts, completions, branch
// decisions, credits purchased/spent, revenue by source, payouts, accessibility usage, top series) from
// GET /admin/dashboard. Each card is a link that drills through to its filtered report route (drillTo);
// those report routes always render (no dead end). Any counterfactual is shown as a LiftBand (a band,
// never a point), per the hard gate. The revenue-by-source chart is rendered as stacked BANDS, not points.
// WCAG 2.2 AA. No emojis, no em dashes.
import { KpiCard, LiftBand, Skeleton } from "@axessplayer/ui";
import { useDashboard } from "../api/useAdminData";
import type { DashboardSeries } from "../api/adminApi";
import { PageHead } from "./Page";
import { Link } from "../router/router";

const SOURCE_COLOR: Record<string, string> = {
  Coins: "#FF2E6E",
  Subs: "#E8B54B",
  Ads: "#5aa6ff",
  Brand: "#1F8A5B",
};

function RevenueChart({ series }: { series: DashboardSeries }) {
  // Bands, not points: each month is a stacked column of source segments. Heights are proportional to the
  // largest column total so the chart reads as relative bands.
  const totals = series.points.map((p) => p.segments.reduce((a, s) => a + s.value, 0));
  const max = Math.max(1, ...totals);
  const keys = series.points[0]?.segments.map((s) => s.key) ?? [];
  return (
    <section className="adm-card" aria-label={series.label}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="adm-card__title">{series.label}</h2>
        <div className="adm-legend">
          {keys.map((k) => (
            <span key={k}>
              <span className="adm-legend__sw" style={{ background: SOURCE_COLOR[k] ?? "var(--axp-muted)" }} aria-hidden />
              {k}
            </span>
          ))}
        </div>
      </div>
      <div className="adm-bars">
        {series.points.map((p, i) => {
          const colHeight = (totals[i] / max) * 100;
          return (
            <div key={p.label} className="adm-bar-col" aria-label={`${p.label}: ${totals[i]}`}>
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", height: `${colHeight}%`, gap: 2 }}>
                {p.segments.map((s, si) => (
                  <div
                    key={s.key}
                    className="adm-bar-seg"
                    style={{
                      flex: s.value,
                      background: SOURCE_COLOR[s.key] ?? "var(--axp-muted)",
                      borderRadius: si === 0 ? "4px 4px 0 0" : si === p.segments.length - 1 ? "0 0 4px 4px" : 0,
                    }}
                  />
                ))}
              </div>
              <span className="adm-bar-label">{p.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function Dashboard() {
  const { data, loading, source } = useDashboard();

  return (
    <section className="adm-page">
      <PageHead
        title="Operations overview"
        subtitle="Platform health, growth, and revenue. Every card drills through to its report."
        right={
          <>
            <span className="adm-pill">Last 28 days</span>
            <span className="adm-pill">All markets</span>
          </>
        }
        source={source}
      />

      {loading || !data ? (
        <div className="adm-kpi-grid">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} height={92} radius={13} />
          ))}
        </div>
      ) : (
        <>
          <div className="adm-kpi-grid">
            {data.kpis.map((k) => (
              <Link
                key={k.key}
                to={k.drillTo}
                className="adm-kpi-link"
                aria-label={`${k.label}: ${k.value}. Open report.`}
              >
                <KpiCard label={k.label} value={k.value} trend={k.band ? undefined : k.trend} tone={k.tone} />
                {k.band && (
                  <div className="adm-kpi__band">
                    <LiftBand low={k.band.low} high={k.band.high} center={k.band.center} label={k.band.label} />
                  </div>
                )}
              </Link>
            ))}
          </div>

          <div className="adm-two-col">
            {data.topSeries[0] && <RevenueChart series={data.topSeries[0]} />}
            <section className="adm-card" aria-label="Red-alert feed">
              <h2 className="adm-card__title">Red-alert feed</h2>
              <div className="adm-alerts">
                <div className="adm-alert adm-alert--danger">
                  <div className="adm-alert__title">2 content processing failures</div>
                  <div className="adm-alert__sub">Dub stage, Luna Rewired Ep7</div>
                </div>
                <div className="adm-alert adm-alert--warn">
                  <div className="adm-alert__title">Generation spend at 86% of cap</div>
                  <div className="adm-alert__sub">Auto-pause at 100%</div>
                </div>
                <div className="adm-alert">
                  <div className="adm-alert__title">14 items in moderation queue</div>
                  <div className="adm-alert__sub">3 flagged comments, 1 upload</div>
                </div>
              </div>
            </section>
          </div>
        </>
      )}
    </section>
  );
}
