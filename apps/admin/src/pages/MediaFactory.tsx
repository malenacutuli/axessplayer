// MEDIA FACTORY (/admin/media-factory). The auto-produce DAG view from GET /admin/media-factory/jobs: one
// job per uploaded episode, each with its per-stage pipeline (ingest, encode, captions, AD, sign, dub, QA),
// a status chip per stage, the stage cost, and the output asset id once a stage produces an artifact. The
// cost gate is surfaced per job (projected cost vs budget) and a job that is over budget shows a "needs
// approval" state. Retry / Kill / Approve-over-budget are RBAC-gated (media.control: Content/Admin/Owner);
// the mutation endpoints are not served yet, so the controls render DISABLED with a "coming soon" hint and
// would emit an audited action when wired (no dead end). ReadOnly never sees the controls. WCAG 2.2 AA.
// No emojis, no em dashes.
import { ErrorState, Skeleton } from "@axessplayer/ui";
import { useMediaFactoryJobs } from "../api/useAdminData";
import type { JobState, MediaJob, StageStatus } from "../api/adminApi";
import { PageHead } from "./Page";
import { useRole } from "../access/useRole";

const STATE_LABEL: Record<JobState, string> = {
  running: "Running",
  done: "Complete",
  failed: "Failed",
  blocked: "Blocked",
  needs_approval: "Needs approval",
};
const STAGE_LABEL: Record<StageStatus, string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
  blocked: "Blocked",
  skipped: "Skipped",
};

function fmtCredits(n: number): string {
  return `${n.toLocaleString("en-US")} cr`;
}

export function MediaFactory() {
  const { data, loading, error, source } = useMediaFactoryJobs();
  const { can } = useRole();
  const canControl = can("media.control");

  if (loading) {
    return (
      <section className="adm-page">
        <PageHead title="Media factory" />
        <Skeleton height={420} radius={14} />
      </section>
    );
  }
  if (error || !data) {
    return (
      <section className="adm-page">
        <PageHead title="Media factory" />
        <ErrorState title="Jobs unavailable">The produce DAG could not be loaded. Try again shortly.</ErrorState>
      </section>
    );
  }

  const jobs = data.jobs;
  const overBudget = jobs.filter((j) => j.overBudget).length;

  return (
    <section className="adm-page">
      <PageHead
        title="Media factory"
        subtitle="Upload once, everything automatic. The auto-produce DAG with per-stage cost and the cost gate."
        right={!canControl ? <span className="adm-pill" title="Read-only role">Read-only</span> : undefined}
        source={source}
      />

      {overBudget > 0 && (
        <div className="adm-alert adm-alert--warn" role="status" style={{ marginBottom: 12 }}>
          <div className="adm-alert__title">Cost gate: {overBudget} job{overBudget > 1 ? "s" : ""} over budget</div>
          <div className="adm-alert__sub">
            An over-budget job pauses at the gate and requires an explicit approve-over-budget action (audit-logged) before it proceeds.
          </div>
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="adm-card">
          <p className="adm-note">No produce jobs in flight. Uploading a master kicks off a new DAG here.</p>
        </div>
      ) : (
        <div className="adm-jobs">
          {jobs.map((job) => (
            <JobCard key={job.jobId} job={job} canControl={canControl} />
          ))}
        </div>
      )}
    </section>
  );
}

function JobCard({ job, canControl }: { job: MediaJob; canControl: boolean }) {
  const budgetPct = Math.min(100, Math.round((job.projectedCost / job.budget) * 100));
  return (
    <section className="adm-card adm-job" aria-label={`Job ${job.seriesTitle} ${job.episodeTitle}`}>
      <div className="adm-job__head">
        <div>
          <div className="adm-cell-title">{job.seriesTitle}</div>
          <div className="adm-cell-muted">{job.episodeTitle}</div>
        </div>
        <span className={`adm-jobstate adm-jobstate--${job.state}`}>{STATE_LABEL[job.state]}</span>
      </div>

      {/* Cost gate */}
      <div className="adm-job__cost">
        <div className="adm-job__costline">
          <span className="adm-cell-mono">{fmtCredits(job.projectedCost)} projected</span>
          <span className="adm-cell-muted">budget {fmtCredits(job.budget)}</span>
        </div>
        <div className={`adm-budgetbar ${job.overBudget ? "is-over" : ""}`} role="progressbar" aria-label="Projected cost against budget" aria-valuenow={budgetPct} aria-valuemin={0} aria-valuemax={100}>
          <div className="adm-budgetbar__fill" style={{ width: `${budgetPct}%` }} />
        </div>
        {job.overBudget && <p className="adm-note adm-note--warn">Over budget. Approval required at the cost gate before remaining stages run.</p>}
      </div>

      {/* Stage DAG */}
      <ol className="adm-stages">
        {job.stages.map((st, i) => (
          <li key={st.name} className="adm-stage">
            <span className="adm-stage__idx" aria-hidden>{i + 1}</span>
            <div className="adm-stage__body">
              <div className="adm-stage__top">
                <span className="adm-stage__name">{st.name}</span>
                <span className={`adm-stagechip adm-stagechip--${st.status}`}>{STAGE_LABEL[st.status]}</span>
              </div>
              <div className="adm-stage__meta">
                <span className="adm-cell-mono">{fmtCredits(st.cost)}</span>
                {st.assetId && <span className="adm-cell-mono">asset {st.assetId}</span>}
                {st.detail && <span className="adm-cell-muted">{st.detail}</span>}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {/* RBAC-gated controls. Mutation endpoints are not served yet: disabled with a coming-soon hint (no
          dead end). When wired these emit an audited action server side. ReadOnly never sees them. */}
      {canControl && (
        <div className="adm-job__actions">
          <button className="adm-soon" disabled aria-disabled title="Stage control endpoint arrives in a later wave">
            Retry (coming soon)
          </button>
          <button className="adm-soon" disabled aria-disabled title="Stage control endpoint arrives in a later wave">
            Kill (coming soon)
          </button>
          <button
            className="adm-soon"
            disabled
            aria-disabled
            title="Cost-gate approval endpoint arrives in a later wave"
          >
            {job.overBudget ? "Approve over budget (coming soon)" : "Approve (coming soon)"}
          </button>
        </div>
      )}
    </section>
  );
}
