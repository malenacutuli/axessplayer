// CREATORS (section 9): /admin/creators (list) and /admin/creators/:id (detail). Read-only. The list shows
// onboarding/KYC status, content count, lifetime earnings, payout status, brand eligibility, and strike
// status; the detail adds the transparent 70/30 revenue split, contract, content library, earnings
// breakdown, rights/consent files, and moderation/strike history. Financial actions (release payout) are
// RBAC-gated (creators.payout -> Finance / Admin / Owner) and rendered coming-soon (a destructive seam, not
// executed). No personal/biometric data leaves the sovereign plane. RBAC: creators.view -> Admin / Owner
// (+ Finance for payouts). WCAG 2.2 AA. No emojis, no em dashes.
import { Button, ErrorState, Skeleton, StatusChip } from "@axessplayer/ui";
import { useCreatorDetail, useCreators } from "../api/useAdminData";
import type { KycStatus, PayoutStatus, StrikeStatus } from "../api/adminApi";
import { PageHead } from "./Page";
import { Link, useRouter } from "../router/router";
import { useRole } from "../access/useRole";

const KYC_LABEL: Record<KycStatus, string> = {
  not_started: "Not started",
  in_review: "In review",
  verified: "Verified",
  rejected: "Rejected",
};
const PAYOUT_LABEL: Record<PayoutStatus, string> = {
  pending: "Pending",
  scheduled: "Scheduled",
  paid: "Paid",
  on_hold: "On hold",
};
const STRIKE_LABEL: Record<StrikeStatus, string> = { clear: "Clear", warning: "Warning", suspended: "Suspended" };

function usd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

function NoAccess() {
  const { navigate } = useRouter();
  return (
    <section className="adm-page">
      <PageHead title="Creators" subtitle="Creator accounts, revenue share, and content portfolios." />
      <ErrorState
        title="Not available for your role"
        action={<Button variant="secondary" onClick={() => navigate("/admin/dashboard")}>Back to dashboard</Button>}
      >
        Creator accounts are limited to Admin and Owner roles (Finance for payouts).
      </ErrorState>
    </section>
  );
}

export function Creators() {
  const { can } = useRole();
  const { data, loading, error, source } = useCreators();

  if (!can("creators.view")) return <NoAccess />;

  if (loading) {
    return (
      <section className="adm-page">
        <PageHead title="Creators" />
        <Skeleton height={320} radius={14} />
      </section>
    );
  }
  if (error || !data) {
    return (
      <section className="adm-page">
        <PageHead title="Creators" />
        <ErrorState title="Creators unavailable">The creators list could not be loaded. Try again shortly.</ErrorState>
      </section>
    );
  }

  return (
    <section className="adm-page">
      <PageHead
        title="Creators"
        subtitle="Creator accounts, the transparent 70/30 share, payouts, and portfolios. Read-only this wave."
        source={source}
      />
      {data.creators.length === 0 ? (
        <div className="adm-card"><p className="adm-note">No creators onboarded in this environment.</p></div>
      ) : (
        <div className="adm-table" aria-label="Creators">
          <div className="adm-tr adm-tr--creators adm-thead">
            <span>CREATOR</span>
            <span>KYC</span>
            <span>CONTENT</span>
            <span>EARNINGS</span>
            <span>PAYOUT</span>
            <span>STRIKES</span>
            <span>BRAND</span>
          </div>
          {data.creators.map((c) => (
            <Link key={c.id} to={`/admin/creators/${c.id}`} className="adm-row-link adm-tr adm-tr--creators" aria-label={`Open ${c.name}`}>
              <span className="adm-cell-title">{c.name}</span>
              <span className="adm-cell-muted">{KYC_LABEL[c.kyc]}</span>
              <span className="adm-cell-mono">{c.contentCount}</span>
              <span className="adm-cell-mono">{usd(c.earningsUsd)}</span>
              <span className="adm-cell-muted">{PAYOUT_LABEL[c.payout]}</span>
              <span className={c.strikes === "clear" ? "adm-cell-muted" : "adm-pill adm-pill--warn"}>{STRIKE_LABEL[c.strikes]}</span>
              <span className="adm-cell-muted">{c.brandEligible ? "Eligible" : "Not eligible"}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export function CreatorDetailPage({ id }: { id: string }) {
  const { can } = useRole();
  const { data, loading, error, source } = useCreatorDetail(id);
  const { navigate } = useRouter();
  const canPayout = can("creators.payout");

  if (!can("creators.view")) return <NoAccess />;

  if (loading) {
    return (
      <section className="adm-page">
        <PageHead title="Creator detail" />
        <Skeleton height={300} radius={14} />
      </section>
    );
  }
  if (error || !data) {
    return (
      <section className="adm-page">
        <PageHead title="Creator detail" />
        <ErrorState
          title="Not found"
          action={<Button variant="secondary" onClick={() => navigate("/admin/creators")}>Back to Creators</Button>}
        >
          No creator with id {id}.
        </ErrorState>
      </section>
    );
  }

  const c = data.creator;

  return (
    <section className="adm-page">
      <PageHead
        title={c.name}
        subtitle={`KYC ${KYC_LABEL[c.kyc]} · payout ${PAYOUT_LABEL[c.payout]} · ${STRIKE_LABEL[c.strikes]}`}
        source={source}
      />

      <div style={{ marginBottom: 14 }}>
        <Link to="/admin/creators" className="adm-cell-muted">Back to Creators</Link>
      </div>

      {/* Transparent revenue split. */}
      <section className="adm-card" aria-label="Revenue share">
        <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Revenue share</h2>
        <div className="adm-split" role="img" aria-label={`Creator ${data.split.creatorPct} percent, platform ${data.split.platformPct} percent`}>
          <div className="adm-split__creator" style={{ width: `${data.split.creatorPct}%` }}>Creator {data.split.creatorPct}%</div>
          <div className="adm-split__platform" style={{ width: `${data.split.platformPct}%` }}>Platform {data.split.platformPct}%</div>
        </div>
        <p className="adm-note" style={{ marginTop: 10 }}>
          The split is shown transparently to the creator. Lifetime creator earnings: {usd(c.earningsUsd)}.
        </p>
      </section>

      <div className="adm-two-col" style={{ marginTop: 14 }}>
        {/* Earnings breakdown. */}
        <section className="adm-card" aria-label="Earnings by source">
          <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Earnings by source</h2>
          <ul className="adm-historylist">
            {data.earnings.map((e) => (
              <li key={e.source} className="adm-historylist__row">
                <span className="adm-cell-title">{e.source}</span>
                <span className="adm-cell-muted" />
                <span className="adm-cell-mono">{usd(e.amountUsd)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Contract. */}
        <section className="adm-card" aria-label="Contract">
          <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Contract</h2>
          <div className="adm-meta">
            <div className="adm-meta__row"><span className="adm-meta__k">Contract id</span><span className="adm-meta__v adm-cell-mono">{data.contract.id}</span></div>
            <div className="adm-meta__row"><span className="adm-meta__k">Signed</span><span className="adm-meta__v">{data.contract.signedAt}</span></div>
            <div className="adm-meta__row"><span className="adm-meta__k">Term</span><span className="adm-meta__v">{data.contract.term}</span></div>
            <div className="adm-meta__row"><span className="adm-meta__k">Brand eligibility</span><span className="adm-meta__v">{c.brandEligible ? "Eligible" : "Not eligible"}</span></div>
          </div>
        </section>
      </div>

      {/* Content library. */}
      <section className="adm-card" style={{ marginTop: 14 }} aria-label="Content library">
        <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Content library</h2>
        {data.library.length === 0 ? (
          <p className="adm-note">No published content yet.</p>
        ) : (
          <div className="adm-tree">
            {data.library.map((item) => (
              <Link key={item.id} to={`/admin/content/${item.id}`} className="adm-tree__row">
                <span>{item.title}</span>
                <span className="adm-cell-mono" style={{ marginLeft: "auto" }}>{item.variants} variants</span>
                <span><StatusChip status={item.status} /></span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Rights / consent files. */}
      <section className="adm-card" style={{ marginTop: 14 }} aria-label="Rights and consent files">
        <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Rights and consent files</h2>
        <ul className="adm-historylist">
          {data.rightsFiles.map((f) => (
            <li key={f.label} className="adm-historylist__row">
              <span className="adm-cell-title">{f.label}</span>
              <span className={f.status === "on_file" ? "adm-pill adm-pill--ok" : "adm-pill adm-pill--warn"}>{f.status.replace(/_/g, " ")}</span>
              <span className="adm-cell-mono">{f.updatedAt}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Moderation / strikes. */}
      <section className="adm-card" style={{ marginTop: 14 }} aria-label="Moderation history">
        <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Moderation history</h2>
        <ul className="adm-historylist">
          {data.moderation.map((m, i) => (
            <li key={i} className="adm-historylist__row">
              <span className="adm-cell-title">{m.label}</span>
              <span className={m.severity === "info" ? "adm-cell-muted" : "adm-pill adm-pill--warn"}>{m.severity}</span>
              <span className="adm-cell-mono">{m.at}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Payout action. RBAC-gated (creators.payout -> Finance / Admin / Owner); a destructive seam, not
          executed this wave, rendered coming-soon. */}
      <section className="adm-card adm-destructive" style={{ marginTop: 14 }} aria-label="Payout">
        <h2 className="adm-card__title">Payout</h2>
        <p className="adm-note adm-note--warn">
          Current status: {PAYOUT_LABEL[c.payout]}. Releasing a payout moves money and writes to the audit
          log when wired. Not executed this wave; the settlement backend is unwired.
        </p>
        {canPayout ? (
          <div className="adm-destructive__actions">
            <button className="adm-soon" disabled aria-disabled title="Payout release endpoint arrives in a later wave">Release payout (coming soon)</button>
            <button className="adm-soon" disabled aria-disabled title="Payout hold endpoint arrives in a later wave">Place on hold (coming soon)</button>
          </div>
        ) : (
          <p className="adm-note">Your role can view this creator but cannot release payouts (Finance / Admin / Owner only).</p>
        )}
      </section>
    </section>
  );
}
