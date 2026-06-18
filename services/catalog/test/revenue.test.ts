// Unit tests for the GET /series/:id/revenue builders + the 70/30 split, run with node:test against a FAKE
// pg (records (text, values), returns canned rows). The focus is the MONEY math: revenueShare() has no
// rounding leak (creator + platform === gross for every integer), the by-source aggregation maps the ledger
// types to the creator-facing source taxonomy, and composeSeriesRevenue keeps the headline split consistent
// with the per-row splits. SELECT-only is asserted by inspecting the built SQL text. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  revenueShare,
  revenueSourceFromType,
  REVENUE_SOURCES,
  CREATOR_SHARE_BPS,
  buildSeriesRevenueBySourceQuery,
  buildSeriesRevenueByEpisodeQuery,
  buildSeriesRevenueByCohortQuery,
  buildSeriesPayoutBalanceQuery,
  mapRevenueBySource,
  mapRevenueByEpisode,
  mapRevenueByCohort,
  composeSeriesRevenue,
  type Queryable,
} from "../src/queries.js";

function fakePg(resultQueue: Array<Array<Record<string, unknown>>>): {
  db: Queryable;
  calls: Array<{ text: string; values: unknown[] }>;
} {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  let i = 0;
  const db: Queryable = {
    async query(text, values) {
      calls.push({ text, values: values ?? [] });
      const rows = resultQueue[i] ?? [];
      i += 1;
      return { rows };
    },
  };
  return { db, calls };
}

// --- revenueShare: the 70/30 split has NO rounding leak ---------------------------------------------

test("revenueShare splits 70/30 with floor on the creator side", () => {
  assert.deepEqual(revenueShare(100), { creator: 70, platform: 30 });
  assert.deepEqual(revenueShare(10), { creator: 7, platform: 3 });
  assert.deepEqual(revenueShare(1000), { creator: 700, platform: 300 });
});

test("revenueShare: creator + platform === gross for every integer (no rounding leak)", () => {
  for (let gross = 0; gross <= 5000; gross += 1) {
    const { creator, platform } = revenueShare(gross);
    assert.equal(creator + platform, gross, `leak at gross=${gross}`);
    // Creator is exactly floor(0.70*gross); platform is the remainder.
    assert.equal(creator, Math.floor((gross * CREATOR_SHARE_BPS) / 10000));
    assert.ok(platform >= 0 && creator >= 0);
  }
});

test("revenueShare: indivisible coins go to the platform remainder, never minted", () => {
  // gross=1: floor(0.7)=0 to creator, 1 to platform. No fractional coin invented anywhere.
  assert.deepEqual(revenueShare(1), { creator: 0, platform: 1 });
  // gross=3: floor(2.1)=2 creator, 1 platform.
  assert.deepEqual(revenueShare(3), { creator: 2, platform: 1 });
});

test("revenueShare clamps non-positive / non-finite input to a 0/0 split", () => {
  assert.deepEqual(revenueShare(0), { creator: 0, platform: 0 });
  assert.deepEqual(revenueShare(-50), { creator: 0, platform: 0 });
  assert.deepEqual(revenueShare(Number.NaN), { creator: 0, platform: 0 });
  assert.deepEqual(revenueShare(12.9), { creator: 8, platform: 4 }); // trunc(12.9)=12 -> 8/4
});

// --- revenueSourceFromType: ledger type -> creator-facing source ------------------------------------

test("revenueSourceFromType maps the ledger taxonomy to revenue sources", () => {
  assert.equal(revenueSourceFromType("spend"), "unlock");
  assert.equal(revenueSourceFromType("refund"), "unlock");
  assert.equal(revenueSourceFromType("rewarded_ad"), "rewarded_ad");
  assert.equal(revenueSourceFromType("offer_wall"), "offer_wall");
  assert.equal(revenueSourceFromType("checkin"), "checkin");
  assert.equal(revenueSourceFromType("iap"), "subscription");
  assert.equal(revenueSourceFromType("subscription"), "subscription");
  assert.equal(revenueSourceFromType("mystery"), null);
  assert.equal(revenueSourceFromType(null), null);
});

// --- SQL shape: SELECT-only, series-scoped attribution, search_path=mobile (unqualified) ------------

test("revenue builders are SELECT-only, parameterize the series id, and attribute through the ledger", () => {
  const series = "11111111-1111-1111-1111-111111111111";
  const specs = [
    buildSeriesRevenueBySourceQuery(series),
    buildSeriesRevenueByEpisodeQuery(series),
    buildSeriesRevenueByCohortQuery(series),
    buildSeriesPayoutBalanceQuery(series),
  ];
  for (const spec of specs) {
    const lower = spec.text.toLowerCase();
    // read-only: no mutation verbs anywhere in the built SQL.
    for (const verb of ["insert", "update", "delete", "drop", "alter", "merge ", "truncate"]) {
      assert.ok(!lower.includes(verb), `mutation verb "${verb}" leaked into a revenue query`);
    }
    // series-scoped: reads the immutable ledger and pins the series id as $1.
    assert.ok(lower.includes("coin_transactions"), "must read the coin_transactions ledger");
    assert.ok(spec.text.includes("$1"), "series id must be a bound parameter, not interpolated");
    assert.deepEqual(spec.values, [series]);
    // unqualified table names so DB_OPTIONS search_path=mobile resolves them (no schema prefix).
    assert.ok(!lower.includes("public.") && !lower.includes("mobile."), "names must stay unqualified");
  }
});

test("by-source query attributes via episodes and beat_variants->beats and excludes unmapped types", () => {
  const text = buildSeriesRevenueBySourceQuery("s1").text.toLowerCase();
  assert.ok(text.includes("episodes"), "joins episodes for episode unlocks");
  assert.ok(text.includes("beat_variants") && text.includes("beats"), "joins beat_variants->beats for cut unlocks");
  assert.ok(text.includes("abs(amount)"), "gross is the non-negative coin volume");
  assert.ok(text.includes("where source is not null"), "drops types outside the revenue taxonomy");
});

// --- mappers: per-row splits ------------------------------------------------------------------------

test("mapRevenueBySource validates the source union and applies a per-source split", () => {
  const rows = [
    { source: "unlock", gross: 100 },
    { source: "rewarded_ad", gross: 10 },
    { source: "bogus", gross: 999 }, // dropped: not in REVENUE_SOURCES
  ];
  const out = mapRevenueBySource(rows);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { source: "unlock", gross: 100, creatorShare: 70, platformShare: 30 });
  assert.deepEqual(out[1], { source: "rewarded_ad", gross: 10, creatorShare: 7, platformShare: 3 });
  // every surfaced source is in the closed union.
  for (const r of out) assert.ok((REVENUE_SOURCES as readonly string[]).includes(r.source));
});

test("mapRevenueByEpisode / mapRevenueByCohort carry their own splits, unassigned cohort defaulted", () => {
  const ep = mapRevenueByEpisode([{ episode_id: "e1", gross: 50 }]);
  assert.deepEqual(ep, [{ episodeId: "e1", gross: 50, creatorShare: 35, platformShare: 15 }]);
  const co = mapRevenueByCohort([{ cohort_id: null, gross: 20 }]);
  assert.deepEqual(co, [{ cohortId: "unassigned", gross: 20, creatorShare: 14, platformShare: 6 }]);
});

// --- composeSeriesRevenue: headline split is consistent with bySource, no leak ----------------------

test("composeSeriesRevenue computes totalGross + a consistent headline 70/30 split", () => {
  const bySource = [
    { source: "unlock", gross: 100 },
    { source: "rewarded_ad", gross: 33 },
  ];
  const byEpisode = [{ episode_id: "e1", gross: 90 }];
  const byCohort = [{ cohort_id: "high_intent", gross: 133 }];
  const payout = [{ gross: 133 }];
  const rev = composeSeriesRevenue(bySource, byEpisode, byCohort, payout);

  assert.equal(rev.totalGross, 133);
  // headline split is computed once on the total: floor(0.7*133)=93, remainder 40.
  assert.equal(rev.creator70, 93);
  assert.equal(rev.platform30, 40);
  assert.equal(rev.creator70 + rev.platform30, rev.totalGross, "headline split has no rounding leak");
  // payoutBalance is the creator 70% of the payout-balance read.
  assert.equal(rev.payoutBalance, 93);
  assert.equal(rev.bySource.length, 2);
  assert.equal(rev.byEpisode[0].episodeId, "e1");
  assert.equal(rev.byCohort[0].cohortId, "high_intent");
});

test("composeSeriesRevenue with an empty ledger is an honest all-zero payload", () => {
  const rev = composeSeriesRevenue([], [], [], []);
  assert.equal(rev.totalGross, 0);
  assert.equal(rev.creator70, 0);
  assert.equal(rev.platform30, 0);
  assert.equal(rev.payoutBalance, 0);
  assert.deepEqual(rev.bySource, []);
  assert.deepEqual(rev.byEpisode, []);
  assert.deepEqual(rev.byCohort, []);
});

// --- a tiny end-to-end through the fake pg (builder -> map) -----------------------------------------

test("by-source query feeds its rows straight into the mapper", async () => {
  const { db, calls } = fakePg([[{ source: "unlock", gross: 200 }]]);
  const spec = buildSeriesRevenueBySourceQuery("s1");
  const res = await db.query(spec.text, spec.values);
  const mapped = mapRevenueBySource(res.rows);
  assert.equal(calls.length, 1);
  assert.deepEqual(mapped, [{ source: "unlock", gross: 200, creatorShare: 140, platformShare: 60 }]);
});
