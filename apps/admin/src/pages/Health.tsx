// SYSTEM HEALTH (section 16): /admin/health. The operational status board for the operator console, from
// GET /admin/health. It shows the known platform services (content, decision, economy, manifest, settlement)
// with an up / degraded / down chip, p95 latency, uptime, and a runbook handle; QoE metrics measured against
// their targets; recent per-service error rates; the produce-pipeline job-failure list; and the active
// alerts (severity + when + runbook link). This is operational telemetry only: no reward weights, no
// personal/biometric data. RBAC: health.view -> Admin / Owner + Support (ReadOnly mirror). Real
// loading / empty / error states; no dead end. WCAG 2.2 AA. No emojis, no em dashes.
import { Button, ErrorState, Skeleton } from "@axessplayer/ui";
import { useHealth } from "../api/useAdminData";
import type { AlertSeverity, JobFailureStage, ServiceStatus } from "../api/adminApi";
import { PageHead } from "./Page";
import { useRouter } from "../router/router";
import { useRole } from "../access/useRole";

const SERVICE_LABEL: Record<ServiceStatus, string> = { up: "Up", degraded: "Degraded", down: "Down" };
const STAGE_LABEL: Record<JobFailureStage, string> = {
  ingest: "Ingest",
  cut_select: "Cut selection",
  render: "Render",
  caption: "Caption",
  dub: "Dub",
  sign: "Sign",
  publish: "Publish",
};
// Alert severity -> the shared issue-row tone (error / warning / ok) used across the console.
const SEV_TONE: Record<AlertSeverity, "error" | "warning" | "ok"> = {
  critical: "error",
  warning: "warning",
  info: "ok",
};
const SEV_LABEL: Record<AlertSeverity, string> = { critical: "CRITICAL", warning: "WARNING", info: "INFO" };

function NoAccess() {
  const { navigate } = useRouter();
  return (
    <section className="adm-page">
      <PageHead title="System health" subtitle="Service status, QoE, error rates, and active alerts." />
      <ErrorState
        title="Not available for your role"
        action={<Button variant="secondary" onClick={() => navigate("/admin/dashboard")}>Back to dashboard</Button>}
      >
        The system health board is limited to Admin, Owner, and Support roles.
      </ErrorState>
    </section>
  );
}

export function Health() {
  const { can } = useRole();
  const { data, loading, error, source } = useHealth();

  if (!can("health.view")) return <NoAccess />;

  if (loading) {
    return (
      <section className="adm-page">
        <PageHead title="System health" />
        <Skeleton height={360} radius={14} />
      </section>
    );
  }
  if (error || !data) {
    return (
      <section className="adm-page">
        <PageHead title="System health" />
        <ErrorState title="Health board unavailable">
          The system health board could not be loaded. Try again shortly.
        </ErrorState>
      </section>
    );
  }

  const down = data.services.filter((s) => s.status === "down").length;
  const degraded = data.services.filter((s) => s.status === "degraded").length;

  return (
    <section className="adm-page">
      <PageHead
        title="System health"
        subtitle="Live service status, quality-of-experience metrics, error rates, job failures, and active alerts. Operational telemetry only."
        source={source}
      />

      {(down > 0 || degraded > 0) && (
        <div className={down > 0 ? "adm-alert adm-alert--danger" : "adm-alert adm-alert--warn"} role="status">
          {down > 0
            ? `${down} service${down > 1 ? "s" : ""} down and ${degraded} degraded. See the status board and active alerts below.`
            : `${degraded} service${degraded > 1 ? "s" : ""} degraded. See the status board and active alerts below.`}
        </div>
      )}

      {/* Active alerts. */}
      <section className="adm-card" style={{ marginTop: 14 }} aria-label="Active alerts">
        <h2 className="adm-card__title" style={{ marginBottom: 10 }}>Active alerts</h2>
        {data.alerts.length === 0 ? (
          <p className="adm-note adm-note--ok">No active alerts. All monitored signals are within target.</p>
        ) : (
          <ul className="adm-issues">
            {data.alerts.map((a) => (
              <li key={a.id} className={`adm-issue adm-issue--${SEV_TONE[a.severity]}`}>
                <span className="adm-issue__sev">{SEV_LABEL[a.severity]}</span>
                <span>
                  {a.summary} <span className="adm-cell-mono">· {a.at}</span>
                  {a.runbook && <span className="adm-cell-muted"> · runbook {a.runbook}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Service status board. */}
      <section className="adm-card" style={{ marginTop: 14 }} aria-label="Service status board">
        <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Service status</h2>
        <div className="adm-table" aria-label="Service rows">
          <div className="adm-tr adm-tr--svc adm-thead">
            <span>SERVICE</span>
            <span>STATUS</span>
            <span>P95</span>
            <span>UPTIME</span>
            <span>RUNBOOK</span>
          </div>
          {data.services.map((s) => (
            <div key={s.key} className="adm-tr adm-tr--svc">
              <span className="adm-cell-title">{s.name}</span>
              <span>
                <span className={`adm-svcstatus adm-svcstatus--${s.status}`}>{SERVICE_LABEL[s.status]}</span>
              </span>
              <span className="adm-cell-mono">{s.latencyMs}ms</span>
              <span className="adm-cell-mono">{s.uptime}</span>
              <span className="adm-cell-muted">{s.runbook ?? "-"}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="adm-two-col" style={{ marginTop: 14 }}>
        {/* QoE metrics against target. */}
        <section className="adm-card" aria-label="Quality of experience">
          <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Quality of experience</h2>
          <ul className="adm-historylist">
            {data.qoe.map((q) => (
              <li key={q.key} className="adm-historylist__row">
                <span className="adm-cell-title">{q.label}</span>
                <span className={q.withinTarget ? "adm-pill adm-pill--ok" : "adm-pill adm-pill--warn"}>
                  {q.withinTarget ? "Within target" : "Over target"}
                </span>
                <span className="adm-cell-mono">{q.value} (target {q.target})</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Error rates. */}
        <section className="adm-card" aria-label="Error rates">
          <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Error rates</h2>
          <div className="adm-table" aria-label="Error-rate rows">
            <div className="adm-tr adm-tr--err adm-thead">
              <span>SERVICE</span>
              <span>RATE</span>
              <span>WINDOW</span>
            </div>
            {data.errorRates.map((e, i) => (
              <div key={i} className="adm-tr adm-tr--err">
                <span className="adm-cell-title">{e.service}</span>
                <span className={e.ratePct >= 1 ? "adm-pill adm-pill--warn" : "adm-pill adm-pill--ok"}>{e.ratePct}%</span>
                <span className="adm-cell-muted">{e.window}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Job failures. */}
      <section className="adm-card" style={{ marginTop: 14 }} aria-label="Recent job failures">
        <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Recent job failures</h2>
        {data.jobFailures.length === 0 ? (
          <p className="adm-note adm-note--ok">No recent pipeline job failures.</p>
        ) : (
          <div className="adm-table" aria-label="Job-failure rows">
            <div className="adm-tr adm-tr--jobf adm-thead">
              <span>STAGE</span>
              <span>TITLE</span>
              <span>REASON</span>
              <span>WHEN</span>
              <span>RETRIES</span>
            </div>
            {data.jobFailures.map((j) => (
              <div key={j.id} className="adm-tr adm-tr--jobf">
                <span className="adm-stagechip adm-stagechip--failed">{STAGE_LABEL[j.stage]}</span>
                <span className="adm-cell-title">{j.title}</span>
                <span className="adm-cell-muted">{j.reason}</span>
                <span className="adm-cell-mono">{j.at}</span>
                <span className="adm-cell-mono">{j.retries}</span>
              </div>
            ))}
          </div>
        )}
        <p className="adm-note" style={{ marginTop: 10 }}>
          Failures are read from the produce-pipeline telemetry. Retry / kill controls live on the media
          factory surface and are RBAC-gated and audit-logged there.
        </p>
      </section>
    </section>
  );
}
