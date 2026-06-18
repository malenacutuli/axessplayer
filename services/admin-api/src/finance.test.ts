// Finance aggregate tests: the double-entry ledger totals fold from coin_transactions, revenue-by-source is
// the per-type breakdown, the creator payout accrual is the 70/30 split (revenueShare) of gross purchase
// revenue and is display-only (executed:false), and FinOps cost is the unwired read model. Stripe stays
// TEST. No live Postgres. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { financeLedgerTotalsSql, financeRevenueByTypeSql, financePurchaseGrossSql } from "./queries.js";
import { buildFinance } from "./finance.js";
import type { QueryPort } from "./aggregate.js";

function fakePg(answers: Array<{ match: RegExp; rows: unknown[] }>): QueryPort {
  return {
    async query(text: string) {
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  } as unknown as QueryPort;
}

test("finance SQL reads coin_transactions for totals, revenue-by-type, and the purchase gross", () => {
  assert.match(financeLedgerTotalsSql().text, /from coin_transactions/);
  assert.match(financeLedgerTotalsSql().text, /as net/);
  assert.match(financeRevenueByTypeSql().text, /group by type/);
  assert.match(financePurchaseGrossSql().text, /type = 'purchase'/);
});

test("buildFinance folds the double-entry ledger and the per-source revenue", async () => {
  const db = fakePg([
    { match: /count\(\*\)::int as transactions/, rows: [{ transactions: 12, credited: 1000, spent: 400, net: 600 }] },
    { match: /group by type order by credited/, rows: [{ type: "purchase", count: 5, credited: 1000, spent: 0 }, { type: "spend", count: 7, credited: 0, spent: 400 }] },
    { match: /type = 'purchase'/, rows: [{ gross: 1000 }] },
  ]);
  const v = await buildFinance(db);
  assert.equal(v.ledger.transactions, 12);
  assert.equal(v.ledger.credited, 1000);
  assert.equal(v.ledger.spent, 400);
  assert.equal(v.ledger.net, 600);
  assert.equal(v.revenueBySource.length, 2);
  assert.equal(v.revenueBySource[0].type, "purchase");
  // Stripe stays TEST; no live rail.
  assert.equal(v.billingMode, "stripe_test");
});

test("creator payout accrual is the 70/30 split of gross purchase revenue, display-only (executed:false)", async () => {
  const db = fakePg([
    { match: /count\(\*\)::int as transactions/, rows: [{ transactions: 1, credited: 1000, spent: 0, net: 1000 }] },
    { match: /group by type/, rows: [] },
    { match: /type = 'purchase'/, rows: [{ gross: 1000 }] },
  ]);
  const v = await buildFinance(db);
  // 70/30 math: creator 700, platform 300, exact (no rounding leak).
  assert.equal(v.payoutAccrual.split.gross, 1000);
  assert.equal(v.payoutAccrual.split.creator, 700);
  assert.equal(v.payoutAccrual.split.platform, 300);
  assert.equal(v.payoutAccrual.split.creator + v.payoutAccrual.split.platform, 1000);
  assert.equal(v.payoutAccrual.sharePolicy.creator, 0.7);
  assert.equal(v.payoutAccrual.sharePolicy.platform, 0.3);
  // DISPLAY-ONLY: no payout executed.
  assert.equal(v.payoutAccrual.executed, false);
});

test("70/30 accrual floors the creator sub-unit (no rounding leak) on an odd gross", async () => {
  const db = fakePg([
    { match: /count\(\*\)::int as transactions/, rows: [{ transactions: 1, credited: 7, spent: 0, net: 7 }] },
    { match: /group by type/, rows: [] },
    { match: /type = 'purchase'/, rows: [{ gross: 7 }] },
  ]);
  const v = await buildFinance(db);
  // 7 * 0.7 = 4.9 -> creator floored to 4, platform gets the remainder 3.
  assert.deepEqual(v.payoutAccrual.split, { gross: 7, creator: 4, platform: 3 });
});

test("FinOps cost is the unwired read model (categories with zero amounts, never fabricated)", async () => {
  const db = fakePg([
    { match: /count\(\*\)::int as transactions/, rows: [{ transactions: 0, credited: 0, spent: 0, net: 0 }] },
    { match: /type = 'purchase'/, rows: [{ gross: 0 }] },
  ]);
  const v = await buildFinance(db);
  assert.equal(v.finOps.source, "unwired");
  assert.ok(v.finOps.lines.length > 0);
  for (const line of v.finOps.lines) {
    assert.equal(line.monthlyMinor, 0);
    assert.equal(line.source, "unwired");
  }
});
