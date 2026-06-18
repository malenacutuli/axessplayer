// ANALYTICS (section 11): /admin/analytics?dim=... The dashboards from GET /admin/analytics?dim=, built on
// the canonical event taxonomy: content / series / episode / branch / ending / a11y / language /
// monetization / funnel / cohorts / retention / churn / LTV / CAC. A dimension switcher drives the dim query
// param. EVERY counterfactual / lift figure is a LiftBand (a band, never a point number). Export is a
// client-side CSV of the loaded rows. Saved segments and scheduled reports are coming-soon affordances.
// RBAC: analytics.view is granted to every role in the matrix (Marketing / Finance / Admin / Owner +
// Content read it); ReadOnly sees a read-only mirror. Real loading / empty / error states. WCAG 2.2 AA.
// No emojis, no em dashes.
import { Button, EmptyState, ErrorState, LiftBand, Skeleton } from "@axessplayer/ui";
import { useAnalytics } from "../api/useAdminData";
import type { AnalyticsDim, AnalyticsReport, AnalyticsRow, KpiBand } from "../api/adminApi";
import { PageHead } from "./Page";
import { useRouter } from "../router/router";
import { useRole } from "../access/useRole";

// The dimension switcher. Every value maps to a real report; the active one is read from / written to the
// dim query param so the report is shareable and bookmarkable (no dead end).
const DIMS: Array<{ key: AnalyticsDim; label: string }> = [
  { key: "series", label: "Series" },
  { key: "episode", label: "Episode" },
  { key: "branch", label: "Branch" },
  { key: "ending", label: "Ending" },
  { key: "a11y", label: "Accessibility" },
  { key: "language", label: "Language" },
  { key: "monetization", label: "Monetization" },
  { key: "funnel", label: "Funnel" },
  { key: "cohorts", label: "Cohorts" },
  { key: "retention", label: "Retention" },
  { key: "churn", label: "Churn" },
  { key: "ltv", label: "LTV" },
  { key: "cac", label: "CAC" },
  { key: "content", label: "Content" },
];

const DIM_KEYS = new Set<AnalyticsDim>(DIMS.map((d) => d.key));
function parseDim(raw: string | null): AnalyticsDim {
  if (raw && DIM_KEYS.has(raw as AnalyticsDim)) return raw as AnalyticsDim;
  return "series";
}

// A counterfactual band is mapped onto a LiftBand. The contract's KpiBand low/high are already percent
// positions of the interval; we pass them straight through and surface the human label.
function BandCell({ band }: { band: KpiBand }) {
  return <LiftBand low={band.low} high={band.high} center={band.center} label={band.label} />;
}

// Build a CSV string from the loaded report rows (client-side, from data already in the browser). Bands are
// serialized as a low..high range so the export stays a band, never a single point.
function toCsv(report: AnalyticsReport): string {
  const head = [...report.columns];
  const lines = [head.map(csvCell).join(",")];
  for (const row of report.rows) {
    const cells: string[] = [row.label, row.value];
    if (report.columns.length >= 3) cells.push(row.secondary ?? "");
    if (report.columns.length >= 4) cells.push(row.band ? `${row.band.low}%..${row.band.high}%` : "");
    lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\r\n");
}
function csvCell(v: string): string {
  const needsQuote = /[",\r\n]/.test(v);
  const escaped = v.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}
function downloadCsv(report: AnalyticsReport) {
  const blob = new Blob([toCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `analytics-${report.dim}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function DimSwitcher({ current, onPick }: { current: AnalyticsDim; onPick: (d: AnalyticsDim) => void }) {
  return (
    <div className="adm-dims" role="tablist" aria-label="Analytics dimension">
      {DIMS.map((d) => (
        <button
          key={d.key}
          role="tab"
          aria-selected={current === d.key}
          className={`adm-dim ${current === d.key ? "is-active" : ""}`}
          onClick={() => onPick(d.key)}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}

function RowsTable({ report }: { report: AnalyticsReport }) {
  const cols = report.columns.length;
  const variant = cols >= 4 ? "adm-tr--an4" : cols >= 3 ? "adm-tr--an3" : "adm-tr--an2";
  return (
    <div className="adm-table" aria-label={report.title}>
      <div className={`adm-tr ${variant} adm-thead`}>
        {report.columns.map((c) => (
          <span key={c}>{c.toUpperCase()}</span>
        ))}
      </div>
      {report.rows.map((row: AnalyticsRow, i) => (
        <div key={`${row.label}-${i}`} className={`adm-tr ${variant}`}>
          <span className="adm-cell-title">{row.label}</span>
          <span className="adm-cell-mono">{row.value}</span>
          {cols >= 3 && <span className="adm-cell-mono">{row.secondary ?? ""}</span>}
          {cols >= 4 && <span>{row.band ? <BandCell band={row.band} /> : <span className="adm-cell-muted">no lift</span>}</span>}
        </div>
      ))}
    </div>
  );
}

export function Analytics() {
  const { isReadOnly } = useRole();
  const { query, navigate } = useRouter();
  const dim = parseDim(query.get("dim"));
  const { data, loading, error, source } = useAnalytics(dim);

  const pick = (d: AnalyticsDim) => navigate(`/admin/analytics?dim=${d}`);

  return (
    <section className="adm-page">
      <PageHead
        title="Analytics"
        subtitle="Watch, branch, completion, accessibility, language, and revenue reports. Every counterfactual lift is shown as a band, never a point."
        source={source}
        right={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Button variant="secondary" onClick={() => data && downloadCsv(data)} disabled={!data || loading}>
              Export CSV
            </Button>
            {/* Saved-segment + scheduled-report seams (not wired this wave). */}
            <button className="adm-soon" disabled aria-disabled title="Saved segments arrive in a later wave">
              Save segment (coming soon)
            </button>
            <button className="adm-soon" disabled aria-disabled title="Scheduled reports arrive in a later wave">
              Schedule report (coming soon)
            </button>
            {isReadOnly && <span className="adm-pill" title="Read-only role">Read-only</span>}
          </div>
        }
      />

      <DimSwitcher current={dim} onPick={pick} />

      {loading && <Skeleton height={320} radius={14} />}
      {!loading && (error || !data) && (
        <ErrorState
          title="Report unavailable"
          action={<Button variant="secondary" onClick={() => navigate("/admin/dashboard")}>Back to dashboard</Button>}
        >
          This analytics report could not be loaded. Try again shortly.
        </ErrorState>
      )}

      {!loading && data && (
        <>
          <div className="adm-an-kpis">
            {data.kpis.map((k) => (
              <div key={k.key} className="adm-card adm-an-kpi">
                <div className="adm-an-kpi__label">{k.label}</div>
                {k.band ? (
                  <>
                    <div className="adm-cell-muted">Counterfactual, shown as a band</div>
                    <BandCell band={k.band} />
                  </>
                ) : (
                  <div className="adm-an-kpi__num">{k.value}</div>
                )}
              </div>
            ))}
          </div>

          {data.rows.length === 0 ? (
            <EmptyState title="No rows for this dimension">
              There is no data for this report yet. This surface is routed and reachable; rows appear here as
              events accrue.
            </EmptyState>
          ) : (
            <RowsTable report={data} />
          )}
        </>
      )}
    </section>
  );
}
