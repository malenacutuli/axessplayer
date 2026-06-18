// FINANCE (section 15): /admin/finance. The double-entry ledger view from GET /admin/finance
// (coin_transactions): each entry shows both legs (debit / credit account), the coin amount, and the USD
// equivalent. Revenue by source / market. Creator payouts with the transparent 70/30 split COMPUTED and
// shown per creator. Payout runs / statements: running a payout is a destructive, RBAC-gated, audit-logged
// 501 SEAM (finance.payout -> Finance / Admin / Owner), rendered disabled coming-soon. FinOps cost + budget
// cap + margin per title. Stripe is TEST until the live-rail decision (a badge says so; no live charges).
// RBAC: finance.view -> Finance / Admin / Owner (ReadOnly mirror). WCAG 2.2 AA. No emojis, no em dashes.
import { Button, ErrorState, Skeleton } from "@axessplayer/ui";
import { useFinance } from "../api/useAdminData";
import type { LedgerEntryKind, PayoutStatus } from "../api/adminApi";
import { PageHead } from "./Page";
import { useRouter } from "../router/router";
import { useRole } from "../access/useRole";

const PAYOUT_LABEL: Record<PayoutStatus, string> = {
  pending: "Pending",
  scheduled: "Scheduled",
  paid: "Paid",
  on_hold: "On hold",
};
const LEDGER_LABEL: Record<LedgerEntryKind, string> = {
  purchase: "Purchase",
  spend: "Spend",
  credit: "Credit",
  refund: "Refund",
  payout: "Payout",
  chargeback: "Chargeback",
  adjustment: "Adjustment",
};

function usd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}
function coins(n: number): string {
  return n === 0 ? "-" : n.toLocaleString("en-US");
}

function NoAccess() {
  const { navigate } = useRouter();
  return (
    <section className="adm-page">
      <PageHead title="Finance" subtitle="Double-entry ledger, revenue, creator payouts, and FinOps." />
      <ErrorState
        title="Not available for your role"
        action={<Button variant="secondary" onClick={() => navigate("/admin/dashboard")}>Back to dashboard</Button>}
      >
        The finance surface is limited to Finance, Admin, and Owner roles.
      </ErrorState>
    </section>
  );
}

export function Finance() {
  const { can } = useRole();
  const { data, loading, error, source } = useFinance();
  const canRun = can("finance.payout");

  if (!can("finance.view")) return <NoAccess />;

  if (loading) {
    return (
      <section className="adm-page">
        <PageHead title="Finance" />
        <Skeleton height={380} radius={14} />
      </section>
    );
  }
  if (error || !data) {
    return (
      <section className="adm-page">
        <PageHead title="Finance" />
        <ErrorState title="Finance unavailable">The finance surface could not be loaded. Try again shortly.</ErrorState>
      </section>
    );
  }

  const stripeTest = data.stripeMode === "test";

  return (
    <section className="adm-page">
      <PageHead
        title="Finance"
        subtitle="The double-entry coin ledger, revenue by source, the transparent 70/30 creator split, and FinOps cost."
        source={source}
        right={
          <span className={stripeTest ? "adm-stripe adm-stripe--test" : "adm-stripe adm-stripe--live"}>
            {stripeTest ? "STRIPE TEST" : "STRIPE LIVE"}
          </span>
        }
      />

      {stripeTest && (
        <div className="adm-alert adm-alert--warn" role="note">
          Stripe is in TEST mode. No live charges or payouts are processed. The live-rail cutover is a separate
          decision gate.
        </div>
      )}

      {/* Revenue by source / market. */}
      <section className="adm-card" style={{ marginTop: 14 }} aria-label="Revenue by source">
        <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Revenue by source and market</h2>
        <div className="adm-table" aria-label="Revenue rows">
          <div className="adm-tr adm-tr--rev adm-thead">
            <span>SOURCE</span>
            <span>MARKET</span>
            <span>REVENUE</span>
            <span>SHARE</span>
          </div>
          {data.revenue.map((r, i) => (
            <div key={i} className="adm-tr adm-tr--rev">
              <span className="adm-cell-title">{r.source}</span>
              <span className="adm-cell-muted">{r.market}</span>
              <span className="adm-cell-mono">{usd(r.amountUsd)}</span>
              <span className="adm-cell-mono">{r.sharePct}%</span>
            </div>
          ))}
        </div>
      </section>

      {/* Creator payouts with the 70/30 split computed. */}
      <section className="adm-card" style={{ marginTop: 14 }} aria-label="Creator payouts">
        <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Creator payouts (70/30 split)</h2>
        <div className="adm-table" aria-label="Payout rows">
          <div className="adm-tr adm-tr--payout adm-thead">
            <span>CREATOR</span>
            <span>GROSS</span>
            <span>CREATOR 70%</span>
            <span>PLATFORM 30%</span>
            <span>STATUS</span>
            <span>ACTION</span>
          </div>
          {data.payouts.map((p) => (
            <div key={p.creatorId} className="adm-tr adm-tr--payout">
              <span className="adm-cell-title">{p.creatorName}</span>
              <span className="adm-cell-mono">{usd(p.grossUsd)}</span>
              <span className="adm-cell-mono">{usd(p.creatorShareUsd)}</span>
              <span className="adm-cell-mono">{usd(p.platformShareUsd)}</span>
              <span className={p.status === "paid" ? "adm-pill adm-pill--ok" : p.status === "on_hold" ? "adm-pill adm-pill--warn" : "adm-cell-muted"}>{PAYOUT_LABEL[p.status]}</span>
              <span>
                {canRun ? (
                  <button className="adm-soon" disabled aria-disabled title="A payout run is a destructive 501 seam this wave; the attempt is audit-logged, no money moves">Run payout (coming soon)</button>
                ) : (
                  <span className="adm-cell-muted">Read-only</span>
                )}
              </span>
            </div>
          ))}
        </div>
        <p className="adm-note" style={{ marginTop: 10 }}>
          The 70/30 split is computed from gross attributable revenue and shown transparently. A payout run /
          statement is a destructive, RBAC-gated, audit-logged 501 seam (Finance / Admin / Owner): the attempt
          is recorded, no money moves this wave.
        </p>
      </section>

      {/* Double-entry ledger. */}
      <section className="adm-card" style={{ marginTop: 14 }} aria-label="Double-entry ledger">
        <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Double-entry coin ledger</h2>
        <div className="adm-table" aria-label="Ledger entries">
          <div className="adm-tr adm-tr--ledger adm-thead">
            <span>WHEN</span>
            <span>KIND</span>
            <span>DEBIT</span>
            <span>CREDIT</span>
            <span>COINS</span>
            <span>USD</span>
          </div>
          {data.ledger.map((e) => (
            <div key={e.id} className="adm-tr adm-tr--ledger">
              <span className="adm-cell-mono">{e.at}</span>
              <span className="adm-cell-title">{LEDGER_LABEL[e.kind]}</span>
              <span className="adm-cell-muted">{e.debitAccount}</span>
              <span className="adm-cell-muted">{e.creditAccount}</span>
              <span className="adm-cell-mono">{coins(e.amountCoins)}</span>
              <span className="adm-cell-mono">{usd(e.amountUsd)}</span>
            </div>
          ))}
        </div>
        <p className="adm-note" style={{ marginTop: 10 }}>
          Every entry has balanced debit and credit legs. The ledger service (coin_transactions) is the source
          of truth; references are pseudonymous.
        </p>
      </section>

      <div className="adm-two-col" style={{ marginTop: 14 }}>
        {/* FinOps cost + budget cap. */}
        <section className="adm-card" aria-label="FinOps cost">
          <h2 className="adm-card__title" style={{ marginBottom: 12 }}>FinOps cost and budget caps</h2>
          <ul className="adm-historylist">
            {data.finops.map((f, i) => (
              <li key={i} className="adm-historylist__row">
                <span className="adm-cell-title">{f.line}</span>
                <span className={f.overCap ? "adm-pill adm-pill--warn" : "adm-pill adm-pill--ok"}>{f.overCap ? "Over cap" : "Within cap"}</span>
                <span className="adm-cell-mono">{usd(f.spendUsd)} / {usd(f.capUsd)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Margin per title. */}
        <section className="adm-card" aria-label="Margin per title">
          <h2 className="adm-card__title" style={{ marginBottom: 12 }}>Margin per title</h2>
          <ul className="adm-historylist">
            {data.margins.map((m) => (
              <li key={m.titleId} className="adm-historylist__row">
                <span className="adm-cell-title">{m.title}</span>
                <span className={m.marginPct < 0 ? "adm-pill adm-pill--warn" : "adm-pill adm-pill--ok"}>{m.marginPct}%</span>
                <span className="adm-cell-mono">{usd(m.revenueUsd)} rev · {usd(m.costUsd)} cost</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}
