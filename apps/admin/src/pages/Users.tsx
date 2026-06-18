// USERS (section 8): /admin/users (list) and /admin/users/:id (detail). A minimized users table (handle,
// tier, subscription, coin balance, coarse region) from GET /admin/users, and a privacy-gated detail from
// GET /admin/users/:id (purchase / watch / branch history + downloads + referrals + sessions, plus the
// viewer's a11y + language defaults). PRIVACY + DATA-MINIMIZATION hard gate: only minimized fields, the
// detail's sensitive sections carry an access-logged note, and no personal/biometric data leaves the
// sovereign plane. GDPR export / delete, ban / suspend, and an audited refund are DESTRUCTIVE seams:
// RBAC-gated (users.manage), confirmation-required, audit-logged, and NOT executed this wave (rendered
// disabled / coming-soon). RBAC: users.view -> Support / Admin / Owner; users.manage -> Admin / Owner.
// WCAG 2.2 AA. No emojis, no em dashes.
import { Button, ErrorState, Skeleton } from "@axessplayer/ui";
import { useUserDetail, useUsers } from "../api/useAdminData";
import type { SubscriptionStatus, UserHistoryItem, UserTier } from "../api/adminApi";
import { PageHead } from "./Page";
import { Link, useRouter } from "../router/router";
import { useRole } from "../access/useRole";

const TIER_LABEL: Record<UserTier, string> = { free: "Free", plus: "Plus", premium: "Premium" };
const SUB_LABEL: Record<SubscriptionStatus, string> = {
  none: "None",
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
  canceled: "Canceled",
};

function NoAccess() {
  const { navigate } = useRouter();
  return (
    <section className="adm-page">
      <PageHead title="Users" subtitle="Accounts, sessions, consent, and data-subject actions." />
      <ErrorState
        title="Not available for your role"
        action={<Button variant="secondary" onClick={() => navigate("/admin/dashboard")}>Back to dashboard</Button>}
      >
        User accounts are limited to Support, Admin, and Owner roles.
      </ErrorState>
    </section>
  );
}

export function Users() {
  const { can } = useRole();
  const { data, loading, error, source } = useUsers();

  if (!can("users.view")) return <NoAccess />;

  if (loading) {
    return (
      <section className="adm-page">
        <PageHead title="Users" />
        <Skeleton height={320} radius={14} />
      </section>
    );
  }
  if (error || !data) {
    return (
      <section className="adm-page">
        <PageHead title="Users" />
        <ErrorState title="Users unavailable">The accounts list could not be loaded. Try again shortly.</ErrorState>
      </section>
    );
  }

  return (
    <section className="adm-page">
      <PageHead
        title="Users"
        subtitle="Minimized accounts. Profile is reduced to the minimum; every access is logged. No biometric data leaves the plane."
        source={source}
      />
      {data.users.length === 0 ? (
        <div className="adm-card"><p className="adm-note">No accounts in this environment.</p></div>
      ) : (
        <div className="adm-table" aria-label="Users">
          <div className="adm-tr adm-tr--users adm-thead">
            <span>HANDLE</span>
            <span>TIER</span>
            <span>SUBSCRIPTION</span>
            <span>BALANCE</span>
            <span>REGION</span>
            <span>JOINED</span>
          </div>
          {data.users.map((u) => (
            <Link key={u.id} to={`/admin/users/${u.id}`} className="adm-row-link adm-tr adm-tr--users" aria-label={`Open ${u.handle}`}>
              <span className="adm-cell-title">{u.handle}</span>
              <span className="adm-cell-muted">{TIER_LABEL[u.tier]}</span>
              <span className="adm-cell-muted">{SUB_LABEL[u.subscription]}</span>
              <span className="adm-cell-mono">{u.balanceCoins.toLocaleString("en-US")} c</span>
              <span className="adm-cell-muted">{u.region}</span>
              <span className="adm-cell-mono">{u.createdAt}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// A privacy-gated section: shows the access-logged note so the operator knows the read is recorded.
function GatedHistory({ title, items }: { title: string; items: UserHistoryItem[] }) {
  return (
    <section className="adm-card adm-gated" aria-label={title}>
      <div className="adm-gated__head">
        <h2 className="adm-card__title">{title}</h2>
        <span className="adm-gated__lock" title="Privacy-gated. This access is logged.">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="4" y="10" width="16" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 018 0v3" />
          </svg>
          Access logged
        </span>
      </div>
      {items.length === 0 ? (
        <p className="adm-note">None on record.</p>
      ) : (
        <ul className="adm-historylist">
          {items.map((it, i) => (
            <li key={i} className="adm-historylist__row">
              <span className="adm-cell-title">{it.label}</span>
              <span className="adm-cell-muted">{it.detail}</span>
              <span className="adm-cell-mono">{it.at}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function UserDetailPage({ id }: { id: string }) {
  const { can } = useRole();
  const { data, loading, error, source } = useUserDetail(id);
  const { navigate } = useRouter();
  const canManage = can("users.manage");

  if (!can("users.view")) return <NoAccess />;

  if (loading) {
    return (
      <section className="adm-page">
        <PageHead title="User detail" />
        <Skeleton height={300} radius={14} />
      </section>
    );
  }
  if (error || !data) {
    return (
      <section className="adm-page">
        <PageHead title="User detail" />
        <ErrorState
          title="Not found"
          action={<Button variant="secondary" onClick={() => navigate("/admin/users")}>Back to Users</Button>}
        >
          No user with id {id}.
        </ErrorState>
      </section>
    );
  }

  const u = data.user;

  return (
    <section className="adm-page">
      <PageHead
        title={u.handle}
        subtitle={`${TIER_LABEL[u.tier]} · ${SUB_LABEL[u.subscription]} · ${u.region}`}
        source={source}
      />

      <div style={{ marginBottom: 14 }}>
        <Link to="/admin/users" className="adm-cell-muted">Back to Users</Link>
      </div>

      {/* Minimized profile summary. */}
      <section className="adm-card" aria-label="Profile">
        <div className="adm-meta">
          <div className="adm-meta__row"><span className="adm-meta__k">Handle</span><span className="adm-meta__v">{u.handle}</span></div>
          <div className="adm-meta__row"><span className="adm-meta__k">Tier</span><span className="adm-meta__v">{TIER_LABEL[u.tier]}</span></div>
          <div className="adm-meta__row"><span className="adm-meta__k">Subscription</span><span className="adm-meta__v">{SUB_LABEL[u.subscription]}</span></div>
          <div className="adm-meta__row"><span className="adm-meta__k">Coin balance</span><span className="adm-meta__v">{u.balanceCoins.toLocaleString("en-US")} c</span></div>
          <div className="adm-meta__row"><span className="adm-meta__k">Region (coarse)</span><span className="adm-meta__v">{u.region}</span></div>
          <div className="adm-meta__row"><span className="adm-meta__k">Joined</span><span className="adm-meta__v">{u.createdAt}</span></div>
        </div>
        <p className="adm-note" style={{ marginTop: 10 }}>
          Data-minimization: legal name, full email, and precise location are not surfaced in the console.
          Biometric and consent signals stay on the sovereign plane.
        </p>
      </section>

      {/* A11y + language defaults (so support can reproduce the viewer's experience). */}
      <section className="adm-card" style={{ marginTop: 14 }} aria-label="Accessibility and language defaults">
        <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Accessibility and language defaults</h2>
        <div className="adm-meta">
          {data.a11yDefaults.map((d) => (
            <div key={d.label} className="adm-meta__row">
              <span className="adm-meta__k">{d.label}</span>
              <span className="adm-meta__v">{d.value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Privacy-gated, access-logged history. */}
      <div className="adm-gated-grid" style={{ marginTop: 14 }}>
        <GatedHistory title="Purchase history" items={data.purchaseHistory} />
        <GatedHistory title="Watch history" items={data.watchHistory} />
        <GatedHistory title="Branch history" items={data.branchHistory} />
        <GatedHistory title="Downloads" items={data.downloads} />
        <GatedHistory title="Referrals" items={data.referrals} />
        <GatedHistory
          title="Sessions"
          items={data.sessions.map((s) => ({ label: s.device, detail: `IP ${s.ip}`, at: s.lastSeen }))}
        />
      </div>

      {/* DESTRUCTIVE data-subject actions. RBAC-gated (users.manage), confirmation-required, audit-logged,
          and NOT executed this wave: the controls are disabled with a coming-soon hint. These are seams, not
          live mutations. */}
      <section className="adm-card adm-destructive" style={{ marginTop: 14 }} aria-label="Data-subject actions">
        <h2 className="adm-card__title">Data-subject actions</h2>
        <p className="adm-note adm-note--warn">
          Destructive. Each action is confirmation-required and writes to the immutable admin audit log when
          wired. Not executed this wave; the mutation backend is unwired.
        </p>
        {canManage ? (
          <div className="adm-destructive__actions">
            <button className="adm-soon" disabled aria-disabled title="GDPR export endpoint arrives in a later wave">GDPR export (coming soon)</button>
            <button className="adm-soon" disabled aria-disabled title="GDPR delete is destructive and not wired this wave">GDPR delete (coming soon)</button>
            <button className="adm-soon" disabled aria-disabled title="Ban / suspend is destructive and not wired this wave">Ban / suspend (coming soon)</button>
            <button className="adm-soon" disabled aria-disabled title="Audited refund endpoint arrives in a later wave">Audited refund (coming soon)</button>
          </div>
        ) : (
          <p className="adm-note">Your role can view this account but cannot perform data-subject actions (Admin / Owner only).</p>
        )}
      </section>
    </section>
  );
}
