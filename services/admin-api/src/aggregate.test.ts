// Aggregation + KPI SQL shape tests against a FAKE pg. A recording fake answers each query by matching a
// fingerprint of its SQL text, so the test asserts BOTH the SQL shape (table names, the filtered
// aggregates that make up each KPI, the schema-qualified content tree) AND that the rows fold into the
// contract DTO correctly. No live Postgres. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  usersCountSql,
  engagementSql,
  decisionsSql,
  coinTotalsSql,
  variantInventorySql,
  topSeriesByEngagementSql,
  variantRollupBySeriesSql,
  latestPolicyVersionSql,
} from "./queries.js";
import { buildDashboard, buildContentTree, buildContentDetail, type QueryPort } from "./aggregate.js";

// ---- Pure SQL shape assertions ----------------------------------------------------------------------

test("KPI SQL shapes are the expected aggregates over the mobile tables", () => {
  assert.match(usersCountSql().text, /count\(\*\)::int as n from users/);

  const eng = engagementSql().text;
  assert.match(eng, /from engagement_events/);
  assert.match(eng, /filter \(where type = 'watch_start'\)/);
  assert.match(eng, /filter \(where type = 'watch_complete'\)/);

  const dec = decisionsSql().text;
  assert.match(dec, /from decision_log/);
  assert.match(dec, /filter \(where is_control\)/);

  const coins = coinTotalsSql().text;
  assert.match(coins, /from coin_transactions/);
  assert.match(coins, /filter \(where amount > 0\)/);
  assert.match(coins, /filter \(where amount < 0\)/);
  assert.match(coins, /filter \(where type = 'purchase'\)/);

  const v = variantInventorySql().text;
  assert.match(v, /from beat_variants/);
  assert.match(v, /caption_doc_url is not null/);
  assert.match(v, /audio_description_url is not null/);
  assert.match(v, /sign_video_url is not null/);

  const top = topSeriesByEngagementSql(7);
  assert.match(top.text, /join series s on s\.id = e\.series_id/);
  assert.deepEqual(top.values, [7]);

  // The content-tree rollup joins variants up through beats to a series.
  assert.match(variantRollupBySeriesSql().text, /from beats b join beat_variants v on v\.beat_id = b\.id/);
});

test("reward weights are never read or written: only a display-only policy_version is selected", () => {
  const sql = latestPolicyVersionSql().text;
  assert.match(sql, /select policy_version from decision_log/);
  assert.doesNotMatch(sql, /weight|w_c|w_r|w_m|reward/i);
});

// ---- Fake pg that answers by SQL fingerprint --------------------------------------------------------

function fakePg(answers: Array<{ match: RegExp; rows: unknown[] }>): QueryPort & { seen: string[] } {
  const seen: string[] = [];
  const fake = {
    seen,
    async query(text: string) {
      seen.push(text);
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  };
  return fake as unknown as QueryPort & { seen: string[] };
}

test("buildDashboard folds rows into KPI cards, topSeries bands, and display-only policy", async () => {
  const db = fakePg([
    { match: /from users/, rows: [{ n: 42 }] },
    { match: /from engagement_events$/m, rows: [{ starts: 100, completions: 70, total: 200 }] },
    { match: /select policy_version from decision_log/, rows: [{ policy_version: "linucb-0.1.0+alpha=1" }] },
    { match: /count\(\*\)::int as total, count\(\*\) filter \(where is_control\)/, rows: [{ total: 500, control: 50 }] },
    { match: /from coin_transactions$/m, rows: [{ transactions: 30, credited: 900, spent: 400, purchased: 600 }] },
    { match: /group by type/, rows: [{ type: "purchase", count: 10, coins: 600 }] },
    { match: /from series$/m, rows: [{ total: 9, published: 5 }] },
    { match: /from beat_variants$/m, rows: [{ total: 80, premium: 12, qa_passed: 60, with_captions: 50, with_ad: 30, with_sign: 20, with_dub: 10 }] },
    { match: /join series s on/, rows: [{ id: "s1", title: "La Otra Llave", events: 120 }] },
  ]);

  const d = await buildDashboard(db);
  const byKey = Object.fromEntries(d.kpis.map((k) => [k.key, k.value]));
  assert.equal(byKey.users, 42);
  assert.equal(byKey.watch_starts, 100);
  assert.equal(byKey.watch_completions, 70);
  assert.equal(byKey.decisions, 500);
  assert.equal(byKey.decisions_control, 50);
  assert.equal(byKey.coins_purchased, 600);
  assert.equal(byKey.coins_spent, 400);
  assert.equal(byKey.series_published, 5);
  assert.equal(byKey.variants_total, 80);
  assert.equal(byKey.variants_a11y, 50 + 30 + 20);

  // Every KPI carries a drillTo hint (no dead ends).
  for (const k of d.kpis) assert.ok(k.drillTo.startsWith("/admin/"), `${k.key} has drillTo`);

  assert.deepEqual(d.topSeries, [{ id: "s1", title: "La Otra Llave", events: 120 }]);

  // HARD GATE: reward weights are display-only.
  assert.equal(d.policy.version, "linucb-0.1.0+alpha=1");
  assert.equal(d.policy.rewardWeightsEditable, false);
});

test("buildContentTree nests channels -> series -> episodes with status, and lists unassigned series", async () => {
  const db = fakePg([
    { match: /from channels/, rows: [{ id: "ch1", slug: "drama", name: "Drama" }] },
    { match: /from series_channels/, rows: [{ series_id: "s1", channel_id: "ch1" }] },
    { match: /from series order by created_at/, rows: [
      { id: "s1", title: "Assigned", genre: "drama", published_at: "2026-01-01" },
      { id: "s2", title: "Orphan", genre: null, published_at: null },
    ] },
    { match: /from episodes order by series_id/, rows: [
      { id: "e1", series_id: "s1", episode_number: 1, title: "Pilot", published_at: "2026-01-02" },
    ] },
    { match: /from beats b join beat_variants/, rows: [
      { series_id: "s1", variants: 4, qa_passed: 3, with_captions: 2, with_ad: 1, with_sign: 0 },
    ] },
  ]);

  const tree = await buildContentTree(db);
  assert.equal(tree.channels.length, 1);
  assert.equal(tree.channels[0].name, "Drama");
  assert.equal(tree.channels[0].series.length, 1);
  const assigned = tree.channels[0].series[0];
  assert.equal(assigned.status, "live");
  assert.equal(assigned.episodes[0].status, "live");
  assert.equal(assigned.inventory.variants, 4);
  assert.equal(assigned.inventory.withCaptions, 2);

  // s2 has no channel mapping, so it lands in unassigned with draft status.
  assert.equal(tree.unassigned.length, 1);
  assert.equal(tree.unassigned[0].title, "Orphan");
  assert.equal(tree.unassigned[0].status, "draft");
});

test("buildContentDetail returns null for an unknown series, full rollup otherwise", async () => {
  const empty = fakePg([{ match: /from series where id/, rows: [] }]);
  assert.equal(await buildContentDetail(empty, "missing"), null);

  const db = fakePg([
    { match: /from series where id/, rows: [{ id: "s1", title: "T", genre: "g", base_language: "en", available_languages: ["en", "es"], published_at: null, poster_url: null }] },
    { match: /from episodes where series_id/, rows: [{ id: "e1", episode_number: 1, title: "Ep", is_free: true, coin_cost: 0, published_at: null }] },
    { match: /from beats where series_id/, rows: [{ id: "b1", episode_id: "e1", beat_index: 0, role: "spine", is_branch_point: false }] },
    { match: /from beat_variants v join beats/, rows: [{ id: "v1", beat_id: "b1", language: "en", tier: "hero", intensity: 3, is_premium: false, qa_status: "passed", caption_doc_url: "u", audio_description_url: null, sign_video_url: null }] },
  ]);
  const detail = await buildContentDetail(db, "s1");
  assert.ok(detail);
  assert.equal(detail.status, "draft");
  assert.deepEqual(detail.availableLanguages, ["en", "es"]);
  assert.equal(detail.episodes[0].isFree, true);
  assert.equal(detail.beats[0].role, "spine");
  assert.equal(detail.variants[0].hasCaptions, true);
  assert.equal(detail.variants[0].hasAudioDescription, false);
});
