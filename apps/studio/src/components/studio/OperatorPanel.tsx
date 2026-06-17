// Operator console: a real Studio route that reads LIVE aggregates from the content service
// (GET /admin/overview) against the active schema (the hosted mobile schema in this deployment). It
// replaces the JSON dev console with an in-product dashboard: content inventory, accessibility-track
// coverage, the double-entry ledger summary, and decision-log volume. Read-only, counts and sums only,
// no PII. No em dashes.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useContentClient } from "../../api/useContentClient.js";
import type { AdminOverview } from "../../api/client.js";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: AdminOverview };

export function OperatorPanel(): JSX.Element {
  const client = useContentClient();
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    client
      .getAdminOverview()
      .then((data) => setState({ status: "loaded", data }))
      .catch((err: unknown) => setState({ status: "error", message: err instanceof Error ? err.message : String(err) }));
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="panel" data-testid="operator-panel">
      <div className="phead">
        <div>
          <div className="axp-eyebrow">Operator console</div>
          <h2>Platform overview</h2>
          <p className="muted">Live aggregates from the content service. Read-only, counts and sums only.</p>
        </div>
        <button type="button" className="paybtn ghost" onClick={load} data-testid="operator-refresh">
          Refresh
        </button>
      </div>

      {state.status === "loading" && <p className="muted" data-testid="operator-loading">Loading overview...</p>}
      {state.status === "error" && (
        <p role="alert" className="statusline err" data-testid="operator-error">
          Could not load overview: {state.message}
        </p>
      )}

      {state.status === "loaded" && <Dashboard data={state.data} />}
    </div>
  );
}

function Dashboard({ data }: { data: AdminOverview }): JSX.Element {
  const v = data.variants;
  return (
    <div className="ops-grid" data-testid="operator-dashboard" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 14 }}>
      <Card title="Content">
        <Stat label="Series published" value={`${data.series.published} / ${data.series.total}`} />
        <Stat label="Variants" value={v.total} />
        <Stat label="QA passed" value={v.qaPassed} />
        <Stat label="Premium gated" value={v.premium} />
      </Card>

      <Card title="Accessibility coverage">
        <Bar label="Captions" n={v.withCaptions} total={v.total} />
        <Bar label="Audio description" n={v.withAudioDescription} total={v.total} />
        <Bar label="Sign language" n={v.withSign} total={v.total} />
        <Bar label="Dubbing" n={v.withDub} total={v.total} />
      </Card>

      <Card title="Ledger (double-entry)">
        <Stat label="Transactions" value={data.ledger.transactions} />
        <Stat label="Coins granted" value={`+${data.ledger.coinsGranted}`} />
        <Stat label="Coins spent" value={`-${data.ledger.coinsSpent}`} />
        <Stat label="Wallets" value={data.ledger.wallets} />
        <Stat label="Total balance" value={data.ledger.walletBalance} />
      </Card>

      <Card title="Transactions by type">
        {data.ledger.byType.length === 0 && <p className="muted">No transactions yet.</p>}
        {data.ledger.byType.map((t) => (
          <Stat key={t.type} label={`${t.type} (x${t.count})`} value={`${t.coins >= 0 ? "+" : ""}${t.coins}`} />
        ))}
      </Card>

      <Card title="Adaptive engine">
        <Stat label="Decisions logged" value={data.decisions} />
        <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          Propensity-logged serving decisions in the decision log.
        </p>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="ops-card" style={{ background: "var(--card,#171221)", border: "1px solid var(--line,#2a2238)", borderRadius: 12, padding: 14 }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>{title}</h3>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div className="ops-stat" style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid #ffffff0d" }}>
      <span className="muted">{label}</span>
      <b>{value}</b>
    </div>
  );
}

function Bar({ label, n, total }: { label: string; n: number; total: number }): JSX.Element {
  const pct = total > 0 ? Math.round((n / total) * 100) : 0;
  return (
    <div className="ops-bar" style={{ padding: "4px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span className="muted">{label}</span>
        <b>{n} / {total} ({pct}%)</b>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "#ffffff14", marginTop: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--brand,#8b7bf0)" }} />
      </div>
    </div>
  );
}
