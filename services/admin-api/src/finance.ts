// Finance read model for GET /admin/finance. Composes the double-entry view from coin_transactions:
//   1. LEDGER. Double-entry-style totals (credits in, debits out, net) so the console shows the balances.
//   2. REVENUE BY SOURCE. The per-transaction-type breakdown (which sources are crediting/spending coins).
//      "revenue" is the OBSERVED ledger volume per source, never a fabricated currency figure.
//   3. CREATOR PAYOUT ACCRUAL. The 70/30 split (revenue.ts revenueShare) applied to the gross purchase
//      base, DISPLAY-ONLY. No payout is executed; payout-run is a 501 audit seam in http/app.ts (Finance/
//      Owner). Stripe stays TEST; no live rail is invoked.
//   4. FINOPS COST. A documented cost read model (infra/provider cost lines). No live billing source is
//      wired, so the lines are flagged source:"unwired"; the shape is real so a cost source is a data swap.
// No em dashes.

import type { QueryPort } from "./aggregate.js";
import {
  financeLedgerTotalsSql,
  financeRevenueByTypeSql,
  financePurchaseGrossSql,
  type Sql,
} from "./queries.js";
import { revenueShare, CREATOR_SHARE, PLATFORM_SHARE, type RevenueSplit } from "./revenue.js";

async function run<T = Record<string, unknown>>(db: QueryPort, sql: Sql): Promise<T[]> {
  const r = await db.query(sql.text, sql.values as unknown[]);
  return r.rows as T[];
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));

// ---- Ledger (double-entry view) --------------------------------------------------------------------

export interface LedgerTotals {
  transactions: number;
  // Credits in (positive amounts) and debits out (the absolute value of negative amounts). net = credited -
  // spent, which equals the sum of signed amounts: the double-entry identity the console asserts against.
  credited: number;
  spent: number;
  net: number;
}

interface LedgerRow {
  transactions: number;
  credited: number;
  spent: number;
  net: number;
}

// ---- Revenue by source -----------------------------------------------------------------------------

export interface RevenueSourceLine {
  type: string;
  count: number;
  credited: number;
  spent: number;
}

interface RevenueRow {
  type: string;
  count: number;
  credited: number;
  spent: number;
}

// ---- Creator payout accrual (70/30, display-only) --------------------------------------------------

export interface PayoutAccrual {
  // The gross creator-revenue base (purchase credits) and its 70/30 split. revenueShare is the single
  // source of truth for the split (creator + platform === gross, no rounding leak).
  split: RevenueSplit;
  sharePolicy: { creator: number; platform: number };
  // Display-only: this is what a payout WOULD be; no payout is executed. Payout-run is a 501 audit seam.
  executed: false;
  note: string;
}

// ---- FinOps cost (documented read model) -----------------------------------------------------------

export interface CostLine {
  category: string;
  label: string;
  // The monthly cost estimate in currency minor units. 0 in the unwired case (no live billing source).
  monthlyMinor: number;
  source: "unwired";
}

export interface FinOpsView {
  lines: CostLine[];
  source: "unwired";
  note: string;
}

// The documented FinOps cost categories. The lines are real cost CATEGORIES (the shape a console renders);
// the amounts are 0 + source:"unwired" because no live billing/provider-cost source is wired. A real
// cost-source read fills the amounts without a shape change. We never fabricate a cost figure.
export const FINOPS_COST_LINES: CostLine[] = [
  { category: "compute", label: "Render / compute", monthlyMinor: 0, source: "unwired" },
  { category: "storage", label: "Object storage + CDN", monthlyMinor: 0, source: "unwired" },
  { category: "database", label: "Managed Postgres", monthlyMinor: 0, source: "unwired" },
  { category: "ml_inference", label: "Decision / ML inference", monthlyMinor: 0, source: "unwired" },
  { category: "third_party", label: "Third-party providers (scan, billing)", monthlyMinor: 0, source: "unwired" },
];

const FINOPS_UNWIRED_NOTE =
  "no live billing / provider-cost source is wired; FinOps cost lines are categories with zero amounts and source:unwired (never fabricated figures)";

// ---- Finance view (GET /admin/finance payload) -----------------------------------------------------

export interface FinanceView {
  ledger: LedgerTotals;
  revenueBySource: RevenueSourceLine[];
  payoutAccrual: PayoutAccrual;
  finOps: FinOpsView;
  // Stripe stays TEST; no live rail is invoked. Surfaced so the console shows the billing mode honestly.
  billingMode: "stripe_test";
  note: string;
}

const PAYOUT_NOTE =
  "creator payout accrual is the 70/30 split (revenueShare) of gross purchase revenue, DISPLAY-ONLY. No payout is executed; payout-run is a 501 audit seam (Finance/Owner). Stripe stays TEST";

export async function buildFinance(db: QueryPort): Promise<FinanceView> {
  const [totalsRows, revenueRows, grossRows] = await Promise.all([
    run<LedgerRow>(db, financeLedgerTotalsSql()),
    run<RevenueRow>(db, financeRevenueByTypeSql()),
    run<{ gross: number }>(db, financePurchaseGrossSql()),
  ]);

  const t = totalsRows[0] ?? { transactions: 0, credited: 0, spent: 0, net: 0 };
  const ledger: LedgerTotals = {
    transactions: num(t.transactions),
    credited: num(t.credited),
    spent: num(t.spent),
    net: num(t.net),
  };

  const gross = num(grossRows[0]?.gross);
  const payoutAccrual: PayoutAccrual = {
    split: revenueShare(gross),
    sharePolicy: { creator: CREATOR_SHARE, platform: PLATFORM_SHARE },
    executed: false,
    note: PAYOUT_NOTE,
  };

  return {
    ledger,
    revenueBySource: revenueRows.map((r) => ({
      type: r.type,
      count: num(r.count),
      credited: num(r.credited),
      spent: num(r.spent),
    })),
    payoutAccrual,
    finOps: { lines: FINOPS_COST_LINES, source: "unwired", note: FINOPS_UNWIRED_NOTE },
    billingMode: "stripe_test",
    note: "finance is the double-entry view composed from coin_transactions; payout is display-only (70/30) and the payout-run is a 501 audit seam",
  };
}
