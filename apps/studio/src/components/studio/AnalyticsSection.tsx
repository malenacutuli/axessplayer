// SECTION 9 - ANALYTICS (/studio/analytics). Per-series analytics read from the catalog
// GET /series/:id/analytics:
//   - a beat-level RETENTION curve drawn as an SVG line over the beats (where viewers swipe away),
//   - variant / branch / ending performance with the off-policy counterfactual shown as a BAND (LiftBand),
//     never a point number (CORRECTIONS C6: a confident wrong number burns trust),
//   - completion, watch-time, the paywall FUNNEL, localization / cohort slices, ending-choice distribution,
//   - an EXPORT affordance (downloads the analytics as JSON).
// The catalog routes may be undeployed in an environment: a 404 renders a graceful empty state, never a dead
// end. Built on @axessplayer/ui (STUDIO skin, LiftBand). WCAG 2.2 AA. No emojis, no em dashes.
import { useMemo, useState } from "react";
import { Button, EmptyState, ErrorState, LiftBand, Skeleton } from "@axessplayer/ui";
import { SeriesPicker } from "./SeriesPicker.js";
import { useSeriesAnalytics } from "../../api/useCatalog.js";
import type { SeriesAnalytics } from "../../api/catalogTypes.js";

export function AnalyticsSection(): JSX.Element {
  const [seriesId, setSeriesId] = useState("");
  const [reload, setReload] = useState(0);
  const state = useSeriesAnalytics(seriesId, reload);

  return (
    <div className="spanel" data-testid="panel-analytics">
      <div className="sbar">
        <div>
          <div className="ey rose">Analytics</div>
          <h2 style={{ marginTop: 8 }}>Retention and counterfactual lift</h2>
        </div>
        {seriesId && state.status === "loaded" && (
          <ExportButton data={state.data} />
        )}
      </div>

      <SeriesPicker selectedId={seriesId} onSelect={setSeriesId} label="Choose a series to analyze" />

      {!seriesId && (
        <p className="muted" data-testid="analytics-idle" style={{ marginTop: 12 }}>
          Pick a series to see its retention, lift bands, funnel, and cohorts.
        </p>
      )}

      {seriesId && state.status === "loading" && (
        <div data-testid="analytics-loading" style={{ marginTop: 12 }} aria-busy="true">
          <Skeleton height={48} />
          <Skeleton height={180} style={{ marginTop: 10 }} />
        </div>
      )}

      {seriesId && state.status === "error" && state.notAvailable && (
        <EmptyState
          title="Analytics are not connected here"
          action={
            <Button variant="secondary" data-testid="analytics-retry" onClick={() => setReload((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          <p className="muted" data-testid="analytics-not-available">
            The catalog analytics service is not reachable in this environment yet. Metrics appear once it is
            connected.
          </p>
        </EmptyState>
      )}

      {seriesId && state.status === "error" && !state.notAvailable && (
        <ErrorState
          title="Could not load analytics"
          action={
            <Button variant="secondary" data-testid="analytics-retry" onClick={() => setReload((n) => n + 1)}>
              Retry
            </Button>
          }
        >
          <p className="muted" data-testid="analytics-error">
            {state.message}
          </p>
        </ErrorState>
      )}

      {seriesId && state.status === "loaded" && <AnalyticsBody data={state.data} />}
    </div>
  );
}

function hasAnyData(a: SeriesAnalytics): boolean {
  return (
    a.beatRetention.length > 0 ||
    a.branchPerformance.length > 0 ||
    a.endingDistribution.length > 0 ||
    a.funnel.length > 0 ||
    a.byCohort.length > 0
  );
}

function AnalyticsBody({ data }: { data: SeriesAnalytics }): JSX.Element {
  if (!hasAnyData(data)) {
    return (
      <p className="muted" data-testid="analytics-empty" style={{ marginTop: 14 }}>
        No engagement yet. Metrics appear once viewers start watching this series.
      </p>
    );
  }
  return (
    <div data-testid="analytics-body" style={{ marginTop: 14 }}>
      <Headline completion={data.completion} watchTimeMs={data.watchTimeMs} />
      <RetentionCurve data={data} />
      <BranchPerformance data={data} />
      <div className="analytics-two-col">
        <EndingDistribution data={data} />
        <PaywallFunnel data={data} />
      </div>
      <CohortSlices data={data} />
    </div>
  );
}

function Headline({ completion, watchTimeMs }: { completion: number; watchTimeMs: number }): JSX.Element {
  const minutes = Math.round(watchTimeMs / 60000);
  return (
    <div className="analytics-kpis" data-testid="analytics-kpis">
      <div className="analytics-kpi">
        <div className="scaption">Completion</div>
        <b data-testid="analytics-completion">{Math.round(completion * 100)}%</b>
      </div>
      <div className="analytics-kpi">
        <div className="scaption">Mean watch time</div>
        <b data-testid="analytics-watchtime">{minutes} min</b>
      </div>
    </div>
  );
}

// The beat-level retention curve, drawn as an SVG polyline over the beats. The accessible mirror is a table
// of the same points so the curve is not the only carrier of the information (WCAG).
function RetentionCurve({ data }: { data: SeriesAnalytics }): JSX.Element {
  const pts = data.beatRetention;
  const W = 560;
  const H = 160;
  const padX = 24;
  const padY = 16;
  const path = useMemo(() => {
    if (pts.length === 0) return "";
    const innerW = W - padX * 2;
    const innerH = H - padY * 2;
    return pts
      .map((p, i) => {
        const x = padX + (pts.length === 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
        const y = padY + (1 - Math.max(0, Math.min(1, p.retention))) * innerH;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }, [pts]);

  return (
    <section aria-label="Beat-level retention curve" data-testid="analytics-retention" style={{ marginTop: 16 }}>
      <div className="scaption">Beat-level retention (where viewers swipe away)</div>
      {pts.length === 0 ? (
        <p className="muted" data-testid="analytics-retention-empty">No beat retention yet.</p>
      ) : (
        <>
          <svg
            className="analytics-curve"
            width="100%"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Retention falls from ${Math.round((pts[0]?.retention ?? 0) * 100)}% at the first beat to ${Math.round((pts[pts.length - 1]?.retention ?? 0) * 100)}% at the last.`}
            data-testid="analytics-curve"
          >
            <line x1={24} y1={H - 16} x2={W - 24} y2={H - 16} stroke="#e3e3ea" strokeWidth={1} />
            <path d={path} fill="none" stroke="var(--rose)" strokeWidth={2.5} />
            {pts.map((p, i) => {
              const innerW = W - 48;
              const innerH = H - 32;
              const x = 24 + (pts.length === 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
              const y = 16 + (1 - Math.max(0, Math.min(1, p.retention))) * innerH;
              return <circle key={p.beatId} cx={x} cy={y} r={3.5} fill="var(--rose)" />;
            })}
          </svg>
          {/* Accessible data mirror of the curve. */}
          <table className="analytics-table" data-testid="analytics-retention-table">
            <thead>
              <tr>
                <th scope="col">Beat</th>
                <th scope="col">Retention</th>
              </tr>
            </thead>
            <tbody>
              {pts.map((p) => (
                <tr key={p.beatId} data-testid={`analytics-retention-${p.beatId}`}>
                  <td className="branch-cell-mono">{p.beatId.slice(-6)}</td>
                  <td>{Math.round(p.retention * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

// Branch / variant / ending performance: the off-policy counterfactual lift shown ONLY as a band (LiftBand),
// never a point. We map the lift fractions to a 0..100 scale centered at 50 (=no change) so the band reads
// as "below baseline" to "above baseline".
function BranchPerformance({ data }: { data: SeriesAnalytics }): JSX.Element {
  if (data.branchPerformance.length === 0) {
    return (
      <section aria-label="Branch performance" data-testid="analytics-branches" style={{ marginTop: 18 }}>
        <div className="scaption">Branch and variant performance</div>
        <p className="muted" data-testid="analytics-branches-empty">No branch comparisons yet.</p>
      </section>
    );
  }
  return (
    <section aria-label="Branch performance" data-testid="analytics-branches" style={{ marginTop: 18 }}>
      <div className="scaption">Branch and variant performance (off-policy lift, a band not a point)</div>
      <ul className="analytics-bands">
        {data.branchPerformance.map((b) => {
          // Map lift fraction (e.g. -0.1 .. +0.2) to a 0..100 band centered at 50.
          const toPct = (v: number) => Math.max(0, Math.min(100, 50 + v * 100));
          const low = toPct(b.lift.low);
          const high = toPct(b.lift.high);
          const center = b.lift.center != null ? toPct(b.lift.center) : undefined;
          const label = `${b.label ?? b.branchId}: estimated lift ${signed(b.lift.low)} to ${signed(b.lift.high)} vs baseline`;
          return (
            <li key={b.branchId} className="analytics-band-row" data-testid={`analytics-branch-${b.branchId}`}>
              <div className="analytics-band-row__label">{b.label ?? b.branchId}</div>
              <LiftBand low={low} high={high} center={center} label={label} />
              <div className="muted analytics-band-row__range" data-testid={`analytics-branch-range-${b.branchId}`}>
                {signed(b.lift.low)} to {signed(b.lift.high)}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function signed(v: number): string {
  const pct = Math.round(v * 1000) / 10;
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function EndingDistribution({ data }: { data: SeriesAnalytics }): JSX.Element {
  return (
    <section aria-label="Ending distribution" data-testid="analytics-endings">
      <div className="scaption">Ending-choice distribution</div>
      {data.endingDistribution.length === 0 ? (
        <p className="muted" data-testid="analytics-endings-empty">No completed runs yet.</p>
      ) : (
        <ul className="analytics-bars">
          {data.endingDistribution.map((e) => {
            const pct = Math.round(e.share * 100);
            return (
              <li key={e.endingId} className="analytics-bar-row" data-testid={`analytics-ending-${e.endingId}`}>
                <span className="analytics-bar-row__label">{e.label ?? e.endingId}</span>
                <span className="analytics-bar-row__track">
                  <span className="analytics-bar-row__fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="muted">{pct}%</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PaywallFunnel({ data }: { data: SeriesAnalytics }): JSX.Element {
  const max = Math.max(1, ...data.funnel.map((f) => f.count));
  return (
    <section aria-label="Paywall funnel" data-testid="analytics-funnel">
      <div className="scaption">Paywall funnel</div>
      {data.funnel.length === 0 ? (
        <p className="muted" data-testid="analytics-funnel-empty">No funnel data yet.</p>
      ) : (
        <ul className="analytics-bars">
          {data.funnel.map((f) => {
            const pct = Math.round((f.count / max) * 100);
            return (
              <li key={f.step} className="analytics-bar-row" data-testid={`analytics-funnel-${slug(f.step)}`}>
                <span className="analytics-bar-row__label">{f.step}</span>
                <span className="analytics-bar-row__track">
                  <span className="analytics-bar-row__fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="muted">{f.count.toLocaleString()}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CohortSlices({ data }: { data: SeriesAnalytics }): JSX.Element {
  return (
    <section aria-label="Localization and cohort slices" data-testid="analytics-cohorts" style={{ marginTop: 18 }}>
      <div className="scaption">Localization and cohort slices</div>
      {data.byCohort.length === 0 ? (
        <p className="muted" data-testid="analytics-cohorts-empty">No cohort breakdown yet.</p>
      ) : (
        <table className="analytics-table">
          <thead>
            <tr>
              <th scope="col">Cohort</th>
              <th scope="col">Completion</th>
              <th scope="col">Mean watch time</th>
            </tr>
          </thead>
          <tbody>
            {data.byCohort.map((c) => (
              <tr key={c.cohort} data-testid={`analytics-cohort-${slug(c.cohort)}`}>
                <td>{c.cohort}</td>
                <td>{Math.round(c.completion * 100)}%</td>
                <td>{Math.round(c.watchTimeMs / 60000)} min</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ExportButton({ data }: { data: SeriesAnalytics }): JSX.Element {
  const onExport = () => {
    try {
      const json = `${JSON.stringify(data, null, 2)}\n`;
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.seriesTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "series"}.analytics.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* download unavailable in this environment */
    }
  };
  return (
    <Button variant="secondary" onClick={onExport} data-testid="analytics-export">
      Export
    </Button>
  );
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}
