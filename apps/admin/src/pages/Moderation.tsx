// MODERATION (section 13): /admin/moderation. THE GATE for viewer V8 social. The moderation QUEUE (UGC
// reports, comments, character-feed posts) from GET /admin/moderation/queue; a report-review flow
// (approve / remove / escalate) and block/mute + takedown controls rendered as RBAC-gated audit SEAMS
// (moderation.act -> Moderation / Admin / Owner; the destructive ones are 501 seams server side, disabled
// coming-soon here); the CSAM/illegal-content + harassment SCAN status surfaced per item as
// pending_provider while the scanner is unwired (NEVER a fabricated clean verdict); the age-gating policy
// view (minors blocked from mature community, no romantic/parasocial overlap) and the rate-limit config from
// GET /admin/moderation/policy. The social tables do not exist yet so the queue is EMPTY: a real empty state,
// never fabricated rows. RBAC: moderation.view (queue) broad; moderation.act -> Moderation / Admin / Owner.
// WCAG 2.2 AA. No emojis, no em dashes.
import { Button, EmptyState, ErrorState, Skeleton } from "@axessplayer/ui";
import { useModerationPolicy, useModerationQueue } from "../api/useAdminData";
import type { ModerationItem, ModerationItemKind, ModerationState, ScanStatus } from "../api/adminApi";
import { PageHead } from "./Page";
import { useRouter } from "../router/router";
import { useRole } from "../access/useRole";

const KIND_LABEL: Record<ModerationItemKind, string> = { report: "Report", comment: "Comment", post: "Feed post" };
const STATE_LABEL: Record<ModerationState, string> = {
  open: "Open",
  in_review: "In review",
  actioned: "Actioned",
  escalated: "Escalated",
};
const SCAN_LABEL: Record<ScanStatus, string> = {
  pending_provider: "Scan pending (provider unwired)",
  clear: "Clear",
  flagged: "Flagged",
  blocked: "Blocked",
};

function NoAccess() {
  const { navigate } = useRouter();
  return (
    <section className="adm-page">
      <PageHead title="Community and moderation" subtitle="Moderation queue, report review, and safety policy." />
      <ErrorState
        title="Not available for your role"
        action={<Button variant="secondary" onClick={() => navigate("/admin/dashboard")}>Back to dashboard</Button>}
      >
        The moderation surface is not available for your role.
      </ErrorState>
    </section>
  );
}

// The unwired-scanner banner. Surfaced whenever the scan provider is not yet wired so the operator never
// mistakes a pending verdict for a clean one. A fabricated clean verdict is a hard gate violation.
function ScannerBanner({ note }: { note: string }) {
  return (
    <div className="adm-alert adm-alert--warn" role="note">
      <strong>Scanning interface not yet wired.</strong> {note}
    </div>
  );
}

function ScanChip({ status }: { status: ScanStatus }) {
  const cls =
    status === "pending_provider"
      ? "adm-pill adm-pill--warn"
      : status === "clear"
        ? "adm-pill adm-pill--ok"
        : "adm-pill adm-pill--warn";
  return <span className={cls}>{SCAN_LABEL[status]}</span>;
}

function QueueRow({ item, canAct }: { item: ModerationItem; canAct: boolean }) {
  return (
    <div className="adm-card" style={{ marginBottom: 12 }} aria-label={`${KIND_LABEL[item.kind]} from ${item.authorHandle}`}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <span className="adm-chip">{KIND_LABEL[item.kind]}</span>
        <span className="adm-cell-title">{item.authorHandle}</span>
        {item.authorIsMinor && <span className="adm-pill adm-pill--warn">Minor account</span>}
        <span className="adm-cell-muted" style={{ marginLeft: "auto" }}>{item.context}</span>
        <span className={item.state === "escalated" ? "adm-pill adm-pill--warn" : "adm-cell-muted"}>{STATE_LABEL[item.state]}</span>
      </div>
      {item.reportReason && <p className="adm-note" style={{ marginTop: 8 }}>Reason: {item.reportReason}</p>}
      <p style={{ marginTop: 8 }}>{item.excerpt}</p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        <ScanChip status={item.scan.status} />
        <span className="adm-cell-muted">Categories: {item.scan.categories.join(", ")}</span>
        {item.scan.provider && <span className="adm-cell-muted">via {item.scan.provider}</span>}
        <span className="adm-cell-mono" style={{ marginLeft: "auto" }}>{item.reportedAt}</span>
      </div>
      {item.scan.note && <p className="adm-note adm-note--warn" style={{ marginTop: 6 }}>{item.scan.note}</p>}

      {/* Report-review + safety actions. RBAC-gated (moderation.act). Approve/escalate are audit seams;
          remove/block/takedown are DESTRUCTIVE 501 seams (record the attempt, execute nothing) this wave. */}
      <div className="adm-destructive__actions" style={{ marginTop: 12 }}>
        {canAct ? (
          <>
            <button className="adm-soon" disabled aria-disabled title="Approve endpoint is an audit seam this wave">Approve (coming soon)</button>
            <button className="adm-soon" disabled aria-disabled title="Escalate endpoint is an audit seam this wave">Escalate (coming soon)</button>
            <button className="adm-soon" disabled aria-disabled title="Remove is a destructive 501 seam this wave; nothing is executed">Remove (coming soon)</button>
            <button className="adm-soon" disabled aria-disabled title="Block/mute is a destructive 501 seam this wave; nothing is executed">Block / mute author (coming soon)</button>
            <button className="adm-soon" disabled aria-disabled title="Takedown is a destructive 501 seam this wave; nothing is executed">Takedown (coming soon)</button>
          </>
        ) : (
          <p className="adm-note">Your role can view the queue but cannot action items (Moderation / Admin / Owner only).</p>
        )}
      </div>
    </div>
  );
}

export function Moderation() {
  const { can } = useRole();
  const queue = useModerationQueue();
  const policy = useModerationPolicy();
  const canAct = can("moderation.act");

  if (!can("moderation.view")) return <NoAccess />;

  if (queue.loading || policy.loading) {
    return (
      <section className="adm-page">
        <PageHead title="Community and moderation" />
        <Skeleton height={360} radius={14} />
      </section>
    );
  }
  if ((queue.error || !queue.data) && (policy.error || !policy.data)) {
    return (
      <section className="adm-page">
        <PageHead title="Community and moderation" />
        <ErrorState title="Moderation unavailable">The moderation surface could not be loaded. Try again shortly.</ErrorState>
      </section>
    );
  }

  const source = queue.source === "demo" || policy.source === "demo" ? "demo" : "live";
  const pol = policy.data;
  const scannerUnwired = pol ? !pol.scanProvider.wired : true;

  return (
    <section className="adm-page">
      <PageHead
        title="Community and moderation"
        subtitle="The moderation queue, report review, the safety scan interface, and age-gating policy. This is the gate that viewer social ships against."
        source={source}
      />

      {/* The safety scanner status. Always surfaced; pending_provider is never a clean verdict. */}
      {pol && scannerUnwired && <ScannerBanner note={pol.scanProvider.note} />}

      {/* The queue. Empty until the social tables exist; a real empty state, never fabricated rows. */}
      <section aria-label="Moderation queue" style={{ marginTop: 14 }}>
        <h2 className="adm-card__title" style={{ marginBottom: 10 }}>Moderation queue</h2>
        {!queue.data || queue.data.items.length === 0 ? (
          <div className="adm-card">
            <EmptyState title="Queue is empty">
              No reports, comments, or feed posts are awaiting review. The social tables are not live yet; once
              viewer social ships, reported content lands here and is scanned by the wired provider before any
              action. Nothing is auto-marked clean.
            </EmptyState>
          </div>
        ) : (
          queue.data.items.map((it) => <QueueRow key={it.id} item={it} canAct={canAct} />)
        )}
      </section>

      {/* Age-gating policy. Minors blocked from mature community; no romantic/parasocial overlap. */}
      {pol && (
        <section className="adm-card" style={{ marginTop: 14 }} aria-label="Age-gating policy">
          <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Age-gating policy</h2>
          <ul className="adm-historylist">
            {pol.ageGates.map((g) => (
              <li key={g.id} className="adm-historylist__row" style={{ alignItems: "flex-start" }}>
                <span className="adm-cell-title">{g.label}</span>
                <span className={g.enforced ? "adm-pill adm-pill--ok" : "adm-pill adm-pill--warn"}>{g.enforced ? "Enforced" : "Not enforced"}</span>
                <span className="adm-cell-muted" style={{ flexBasis: "100%", marginTop: 4 }}>{g.rule}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Rate-limit config (read this wave). */}
      {pol && (
        <section className="adm-card" style={{ marginTop: 14 }} aria-label="Rate-limit configuration">
          <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Rate-limit configuration</h2>
          <div className="adm-table" aria-label="Rate limits">
            <div className="adm-tr adm-tr--rate adm-thead">
              <span>SCOPE</span>
              <span>LIMIT</span>
              <span>APPLIES TO</span>
            </div>
            {pol.rateLimits.map((r) => (
              <div key={r.id} className="adm-tr adm-tr--rate">
                <span className="adm-cell-title">{r.scope}</span>
                <span className="adm-cell-mono">{r.limit}</span>
                <span className="adm-cell-muted">{r.appliesTo}</span>
              </div>
            ))}
          </div>
          <p className="adm-note" style={{ marginTop: 10 }}>
            Rate limits are read-only this wave. Editing them is an RBAC-gated, audit-logged seam that arrives
            with the social write path.
          </p>
        </section>
      )}
    </section>
  );
}
