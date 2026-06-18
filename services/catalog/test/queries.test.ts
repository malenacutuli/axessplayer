// Unit tests for the pure catalog query builders + mappers, run with node:test against a FAKE pg. No real
// database: the fake records the (text, values) it is called with and returns canned rows, so the tests
// assert SQL SHAPE (which tables/columns/filters the builder targets) and RESULT MAPPING (a11y chip
// derivation, trending aggregation + fallback, calibrate merge, locked/endings derivation). This is the
// testability seam the service is split along. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACCOUNT_SERIES_SENTINEL,
  buildCalibrateUpsert,
  buildChannelHeaderQuery,
  buildChannelSeriesQuery,
  buildChannelsQuery,
  buildContinueQuery,
  buildSearchChannelsQuery,
  buildSearchCharactersQuery,
  buildSearchShowsQuery,
  beatLabelFromRow,
  buildSeriesA11yQuery,
  buildSeriesCutsQuery,
  buildSeriesEpisodesQuery,
  buildSeriesHeaderQuery,
  buildTrendingFallbackQuery,
  buildTrendingQuery,
  calibratePayoff,
  calibrationVector,
  composeChannelDetail,
  composeSeriesDetail,
  CUT_VARIANT_KINDS,
  cutKindFromRow,
  cutLabelFromRow,
  deriveAccessibilityRating,
  likePattern,
  mapChannelRows,
  mapContinueRows,
  mapSearchResults,
  mapSeriesCutsRows,
  mapTrendingRows,
  parseCalibrateInput,
  TRENDING_EVENT_TYPES,
  buildChannelExistsQuery,
  buildChannelFollowerCountQuery,
  buildChannelFollowerTrendQuery,
  buildChannelFollowerPriorsQuery,
  buildChannelNotificationAudienceQuery,
  buildChannelSeriesPerformanceQuery,
  mapFollowerTrend,
  mapChannelSeriesPerformance,
  composeChannelAnalytics,
  type Queryable,
} from "../src/queries.js";

// A fake pg: records every call and replays a queue of canned result sets in order.
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

// --- parseCalibrateInput ---------------------------------------------------------------------------

test("parseCalibrateInput accepts a valid body and clamps intensity to 1..5", () => {
  assert.deepEqual(parseCalibrateInput({ pace: "tense", pov: " maya ", intensity: 9 }), {
    pace: "tense",
    pov: "maya",
    intensity: 5,
  });
  assert.deepEqual(parseCalibrateInput({ pace: "slow_burn", pov: "diego", intensity: 0 }), {
    pace: "slow_burn",
    pov: "diego",
    intensity: 1,
  });
});

test("parseCalibrateInput rejects bad pace, empty pov, and non-finite intensity", () => {
  assert.equal(parseCalibrateInput({ pace: "fast", pov: "x", intensity: 3 }), null);
  assert.equal(parseCalibrateInput({ pace: "tense", pov: "   ", intensity: 3 }), null);
  assert.equal(parseCalibrateInput({ pace: "tense", pov: "x", intensity: "abc" }), null);
  assert.equal(parseCalibrateInput(null), null);
});

// --- calibrate upsert: merge, not clobber ----------------------------------------------------------

test("buildCalibrateUpsert merges preference_vector without clobbering and pins the account sentinel", () => {
  const input = { pace: "tense" as const, pov: "maya", intensity: 4 };
  const spec = buildCalibrateUpsert("11111111-1111-1111-1111-111111111111", input);
  // It writes viewer_state and concatenates jsonb so existing keys survive.
  assert.match(spec.text, /insert into viewer_state/);
  assert.match(spec.text, /preference_vector \|\| excluded\.preference_vector/);
  assert.match(spec.text, /on conflict \(user_id, series_id\)/);
  // Values: userId, the account-level sentinel series, and the JSON fragment with exactly the 3 keys.
  assert.equal(spec.values[0], "11111111-1111-1111-1111-111111111111");
  assert.equal(spec.values[1], ACCOUNT_SERIES_SENTINEL);
  assert.deepEqual(JSON.parse(spec.values[2] as string), {
    pace: "tense",
    pov: "maya",
    intensity: 4,
  });
});

test("calibrationVector carries only pace/pov/intensity (no extra keys to clobber with)", () => {
  assert.deepEqual(calibrationVector({ pace: "slow_burn", pov: "x", intensity: 2 }), {
    pace: "slow_burn",
    pov: "x",
    intensity: 2,
  });
});

test("calibratePayoff returns the CUT FOR YOU badge and a pace-keyed summary", () => {
  const tense = calibratePayoff({ pace: "tense", pov: "maya", intensity: 5 });
  assert.equal(tense.badge, "CUT FOR YOU");
  assert.match(tense.summary, /tense/);
  assert.match(tense.summary, /maya/);
  const slow = calibratePayoff({ pace: "slow_burn", pov: "diego", intensity: 1 });
  assert.match(slow.summary, /slow-burn/);
});

// --- continue --------------------------------------------------------------------------------------

test("buildContinueQuery reads viewer_state progress, excludes the sentinel, joins series", () => {
  const spec = buildContinueQuery("u1");
  assert.match(spec.text, /from viewer_state vs/);
  assert.match(spec.text, /join series s on s\.id = vs\.series_id/);
  assert.match(spec.text, /preference_vector \? 'progress'/);
  assert.match(spec.text, /vs\.series_id <> \$2/);
  assert.deepEqual(spec.values, ["u1", ACCOUNT_SERIES_SENTINEL]);
});

test("mapContinueRows maps fields and clamps progress to 0..1", () => {
  const out = mapContinueRows([
    { series_id: "s1", title: "A", poster: "p1", beat_id: "b1", progress: 0.4 },
    { series_id: "s2", title: "B", poster: null, beat_id: null, progress: 5 },
  ]);
  assert.deepEqual(out, [
    { seriesId: "s1", title: "A", poster: "p1", beatId: "b1", progress: 0.4 },
    { seriesId: "s2", title: "B", poster: null, beatId: null, progress: 1 },
  ]);
});

// --- trending: aggregation + fallback --------------------------------------------------------------

test("buildTrendingQuery aggregates engagement_events by the engagement event types over a window", () => {
  const spec = buildTrendingQuery(10, 7);
  assert.match(spec.text, /from engagement_events e/);
  assert.match(spec.text, /count\(e\.id\) as score/);
  assert.match(spec.text, /e\.type = any\(\$1\)/);
  assert.match(spec.text, /order by score desc/);
  assert.deepEqual(spec.values[0], Array.from(TRENDING_EVENT_TYPES));
  assert.equal(spec.values[1], "7");
  assert.equal(spec.values[2], 10);
});

test("buildTrendingFallbackQuery selects recently published series", () => {
  const spec = buildTrendingFallbackQuery(5);
  assert.match(spec.text, /from series s/);
  assert.match(spec.text, /published_at is not null/);
  assert.match(spec.text, /order by s\.published_at desc/);
  assert.deepEqual(spec.values, [5]);
});

test("mapTrendingRows maps the card fields", () => {
  const out = mapTrendingRows([{ series_id: "s1", title: "T", poster: null, genre: "Crime" }]);
  assert.deepEqual(out, [{ seriesId: "s1", title: "T", poster: null, genre: "Crime" }]);
});

// --- series detail: a11y chip derivation + locked/endings ------------------------------------------

test("buildSeriesA11yQuery derives chips from track URL presence and counts endings + langs", () => {
  const spec = buildSeriesA11yQuery("s1");
  assert.match(spec.text, /bool_or\(v\.caption_doc_url is not null\) as has_cc/);
  assert.match(spec.text, /bool_or\(v\.audio_description_url is not null\) as has_ad/);
  assert.match(spec.text, /bool_or\(v\.sign_video_url is not null\) as has_sign/);
  assert.match(spec.text, /count\(distinct v\.language\)/);
  assert.match(spec.text, /v\.variant_kind = 'alt_ending'/);
  assert.match(spec.text, /v\.axis = 'ending'/);
  assert.match(spec.text, /join beats b on b\.id = v\.beat_id/);
  assert.deepEqual(spec.values, ["s1"]);
});

test("buildSeriesEpisodesQuery locks paid non-free episodes and orders by number", () => {
  const spec = buildSeriesEpisodesQuery("s1");
  assert.match(spec.text, /from episodes e/);
  assert.match(spec.text, /coalesce\(e\.is_free, false\) = false and e\.coin_cost > 0/);
  assert.match(spec.text, /order by e\.episode_number asc/);
});

test("composeSeriesDetail derives a11y chips, langs, endingsCount, episodeCount", () => {
  const detail = composeSeriesDetail(
    [{ id: "s1", title: "Show", poster: "p", genre: "Thriller", format: "Series" }],
    [
      { id: "e1", number: 1, coin_cost: 0, locked: false },
      { id: "e2", number: 2, coin_cost: 30, locked: true },
    ],
    [{ has_cc: true, has_ad: false, has_sign: true, lang_count: 3, endings_count: 4 }]
  );
  assert.ok(detail);
  assert.equal(detail.format, "Series");
  assert.equal(detail.episodeCount, 2);
  assert.equal(detail.endingsCount, 4);
  assert.deepEqual(detail.a11y, { cc: true, ad: false, sign: true, langs: 3 });
  assert.deepEqual(detail.episodes[1], { id: "e2", number: 2, coinCost: 30, locked: true });
  assert.equal(detail.hero.id, "s1");
});

test("composeSeriesDetail returns null when the series header is absent (404 path)", () => {
  assert.equal(composeSeriesDetail([], [], []), null);
});

test("composeSeriesDetail defaults format to Series and a11y to all-false when aggregates are empty", () => {
  const detail = composeSeriesDetail(
    [{ id: "s1", title: "Show", poster: null, genre: null }],
    [],
    []
  );
  assert.ok(detail);
  assert.equal(detail.format, "Series");
  assert.deepEqual(detail.a11y, { cc: false, ad: false, sign: false, langs: 0 });
  assert.equal(detail.endingsCount, 0);
  assert.equal(detail.episodeCount, 0);
});

// --- series cuts: grouping + kind/label mapping + premium filter -----------------------------------

test("buildSeriesCutsQuery filters to cut kinds OR premium, joins beats, orders for stable grouping", () => {
  const spec = buildSeriesCutsQuery("s1");
  assert.match(spec.text, /from beat_variants v/);
  assert.match(spec.text, /join beats b on b\.id = v\.beat_id/);
  // premium filter: keep cut-kind variants OR is_premium variants
  assert.match(spec.text, /v\.variant_kind = any\(\$2\)/);
  assert.match(spec.text, /coalesce\(v\.is_premium, false\) = true/);
  assert.match(spec.text, /where b\.series_id = \$1/);
  // deterministic ordering so the mapper can group in one pass
  assert.match(spec.text, /order by b\.beat_index asc, v\.id asc/);
  // coalesced cost/premium defaults
  assert.match(spec.text, /coalesce\(v\.coin_cost, 0\) as coin_cost/);
  assert.match(spec.text, /coalesce\(v\.is_premium, false\) as is_premium/);
  assert.deepEqual(spec.values, ["s1", Array.from(CUT_VARIANT_KINDS)]);
});

test("CUT_VARIANT_KINDS is exactly the contract's alternate-cut union", () => {
  assert.deepEqual(Array.from(CUT_VARIANT_KINDS), ["alt_ending", "pov", "intensity"]);
});

test("cutKindFromRow passes through cut kinds and falls back to intensity for premium-only non-cut kinds", () => {
  assert.equal(cutKindFromRow("alt_ending"), "alt_ending");
  assert.equal(cutKindFromRow("pov"), "pov");
  assert.equal(cutKindFromRow("intensity"), "intensity");
  // a premium master/dub/brand variant qualified by is_premium maps to the neutral paid-cut kind
  assert.equal(cutKindFromRow("master"), "intensity");
  assert.equal(cutKindFromRow("brand"), "intensity");
  assert.equal(cutKindFromRow(null), "intensity");
});

test("cutLabelFromRow prefers axis_value, falls back to a title-cased kind", () => {
  assert.equal(cutLabelFromRow("Maya", "pov"), "Maya");
  assert.equal(cutLabelFromRow("  Diego  ", "pov"), "Diego");
  assert.equal(cutLabelFromRow(null, "alt_ending"), "Alt Ending");
  assert.equal(cutLabelFromRow("", "intensity"), "Intensity");
  assert.equal(cutLabelFromRow(null, ""), "Cut");
});

test("beatLabelFromRow derives a label from role + beat_index, falling back to Beat N", () => {
  assert.equal(beatLabelFromRow("climax", 4), "Climax (Beat 4)");
  assert.equal(beatLabelFromRow("inciting_incident", 1), "Inciting Incident (Beat 1)");
  assert.equal(beatLabelFromRow(null, 2), "Beat 2");
  assert.equal(beatLabelFromRow("  ", 3), "Beat 3");
});

test("mapSeriesCutsRows groups variants per beat preserving order and maps each cut", () => {
  const out = mapSeriesCutsRows([
    {
      beat_id: "b1",
      beat_index: 1,
      beat_role: "setup",
      variant_id: "v1",
      variant_kind: "pov",
      axis: "pov",
      axis_value: "Maya",
      coin_cost: 20,
      is_premium: false,
    },
    {
      beat_id: "b1",
      beat_index: 1,
      beat_role: "setup",
      variant_id: "v2",
      variant_kind: "intensity",
      axis: "intensity",
      axis_value: null,
      coin_cost: "0",
      is_premium: false,
    },
    {
      beat_id: "b2",
      beat_index: 4,
      beat_role: "climax",
      variant_id: "v3",
      variant_kind: "alt_ending",
      axis: "ending",
      axis_value: "Hopeful Ending",
      coin_cost: 50,
      is_premium: true,
    },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    beatId: "b1",
    beatLabel: "Setup (Beat 1)",
    cuts: [
      { variantId: "v1", kind: "pov", label: "Maya", coinCost: 20, isPremium: false },
      { variantId: "v2", kind: "intensity", label: "Intensity", coinCost: 0, isPremium: false },
    ],
  });
  assert.deepEqual(out[1], {
    beatId: "b2",
    beatLabel: "Climax (Beat 4)",
    cuts: [
      { variantId: "v3", kind: "alt_ending", label: "Hopeful Ending", coinCost: 50, isPremium: true },
    ],
  });
});

test("mapSeriesCutsRows returns an empty array when the series has no cut-bearing variants", () => {
  assert.deepEqual(mapSeriesCutsRows([]), []);
});

// --- search across shows, characters (POV cuts), channels ------------------------------------------

test("likePattern escapes LIKE metacharacters and wraps in wildcards", () => {
  assert.equal(likePattern("50%_off"), "%50\\%\\_off%");
  assert.equal(likePattern("abc"), "%abc%");
});

test("buildSearchShowsQuery searches series titles case-insensitively", () => {
  const spec = buildSearchShowsQuery("luz");
  assert.match(spec.text, /from series s/);
  assert.match(spec.text, /s\.title ilike \$1 escape/);
  assert.equal(spec.values[0], "%luz%");
});

test("buildSearchCharactersQuery derives characters from POV-cut axis values", () => {
  const spec = buildSearchCharactersQuery("maya");
  assert.match(spec.text, /from beat_variants v/);
  assert.match(spec.text, /v\.axis = 'pov'/);
  assert.match(spec.text, /v\.axis_value ilike \$1/);
  assert.equal(spec.values[0], "%maya%");
});

test("buildSearchChannelsQuery searches channel name and slug", () => {
  const spec = buildSearchChannelsQuery("crime");
  assert.match(spec.text, /from channels c/);
  assert.match(spec.text, /c\.name ilike \$1.*or c\.slug ilike \$1/s);
});

test("mapSearchResults maps the three result sets into the contract shape", () => {
  const out = mapSearchResults(
    [{ series_id: "s1", title: "Show", poster: "p", genre: "Crime" }],
    [{ name: "Maya", series_id: "s1" }],
    [{ id: "c1", slug: "crime", name: "Crime" }]
  );
  assert.deepEqual(out, {
    shows: [{ seriesId: "s1", title: "Show", poster: "p", genre: "Crime" }],
    characters: [{ name: "Maya", seriesId: "s1" }],
    channels: [{ id: "c1", slug: "crime", name: "Crime" }],
  });
});

// --- builders run against the fake pg (smoke: the spec round-trips through query()) ----------------

// --- channels rail: showCount join ------------------------------------------------------------------

test("buildChannelsQuery left-joins series_channels and counts mapped series per channel", () => {
  const spec = buildChannelsQuery();
  assert.match(spec.text, /from channels c/);
  assert.match(spec.text, /left join series_channels sc on sc\.channel_id = c\.id/);
  assert.match(spec.text, /count\(sc\.series_id\) as show_count/);
  assert.match(spec.text, /group by c\.id/);
  assert.match(spec.text, /order by c\.name asc/);
  assert.deepEqual(spec.values, []);
});

test("mapChannelRows maps the rail fields, coerces genres[] and showCount, tolerates nulls", () => {
  const out = mapChannelRows([
    { id: "c1", slug: "crime", name: "Crime", genres: ["Crime", "Thriller"], hero_url: "h1", show_count: "4" },
    { id: "c2", slug: "doc", name: "Docs", genres: null, hero_url: null, show_count: 0 },
  ]);
  assert.deepEqual(out, [
    { id: "c1", slug: "crime", name: "Crime", genres: ["Crime", "Thriller"], heroUrl: "h1", showCount: 4 },
    { id: "c2", slug: "doc", name: "Docs", genres: [], heroUrl: null, showCount: 0 },
  ]);
});

// --- channel detail: series join + rating/episodes + badge derivation -------------------------------

test("buildChannelHeaderQuery selects the single channel header", () => {
  const spec = buildChannelHeaderQuery("c1");
  assert.match(spec.text, /from channels c/);
  assert.match(spec.text, /where c\.id = \$1/);
  assert.deepEqual(spec.values, ["c1"]);
});

test("buildChannelSeriesQuery joins series_channels->series, counts episodes, derives a11y badges", () => {
  const spec = buildChannelSeriesQuery("c1");
  assert.match(spec.text, /from series_channels sc/);
  assert.match(spec.text, /join series s on s\.id = sc\.series_id/);
  assert.match(spec.text, /left join episodes e on e\.series_id = s\.id/);
  assert.match(spec.text, /left join beats b on b\.series_id = s\.id/);
  assert.match(spec.text, /left join beat_variants v on v\.beat_id = b\.id/);
  assert.match(spec.text, /count\(distinct e\.id\) as episode_count/);
  assert.match(spec.text, /bool_or\(v\.caption_doc_url is not null\) as has_cc/);
  assert.match(spec.text, /bool_or\(v\.audio_description_url is not null\) as has_ad/);
  assert.match(spec.text, /bool_or\(v\.sign_video_url is not null\) as has_sign/);
  assert.match(spec.text, /coalesce\(s\.poster_url, s\.cover_url\) as poster/);
  assert.match(spec.text, /where sc\.channel_id = \$1/);
  assert.deepEqual(spec.values, ["c1"]);
});

test("deriveAccessibilityRating starts at 3.5 and adds 0.5 per track, capped at 5", () => {
  assert.equal(deriveAccessibilityRating(false, false, false), 3.5);
  assert.equal(deriveAccessibilityRating(true, false, false), 4);
  assert.equal(deriveAccessibilityRating(true, true, false), 4.5);
  assert.equal(deriveAccessibilityRating(true, true, true), 5);
});

test("composeChannelDetail builds the header + series with badges, rating, episodes, showCount", () => {
  const detail = composeChannelDetail(
    [{ id: "c1", name: "Crime", hero_url: "h1" }],
    [
      { series_id: "s1", title: "Show A", poster: "p1", episode_count: 6, has_cc: true, has_ad: true, has_sign: false },
      { series_id: "s2", title: "Show B", poster: null, episode_count: "0", has_cc: false, has_ad: false, has_sign: false },
    ]
  );
  assert.ok(detail);
  assert.equal(detail.id, "c1");
  assert.equal(detail.name, "Crime");
  assert.equal(detail.heroUrl, "h1");
  assert.equal(detail.showCount, 2);
  assert.deepEqual(detail.series[0], {
    seriesId: "s1",
    title: "Show A",
    poster: "p1",
    rating: 4.5,
    episodes: 6,
    badges: { cc: true, ad: true, sign: false },
  });
  assert.deepEqual(detail.series[1], {
    seriesId: "s2",
    title: "Show B",
    poster: null,
    rating: 3.5,
    episodes: 0,
    badges: { cc: false, ad: false, sign: false },
  });
});

test("composeChannelDetail returns null when the channel header is absent (404 path)", () => {
  assert.equal(composeChannelDetail([], []), null);
});

test("a builder spec round-trips through the fake pg query() unchanged", async () => {
  const { db, calls } = fakePg([[{ id: "s1", title: "Show", poster: null, genre: null, format: "Film" }]]);
  const spec = buildSeriesHeaderQuery("s1");
  const r = await db.query(spec.text, spec.values);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, spec.text);
  assert.deepEqual(calls[0].values, ["s1"]);
  assert.equal(r.rows[0].format, "Film");
});

// --- channel analytics: follower trend bucketing, series performance join, notify audience ----------

test("buildChannelExistsQuery is a single-row channel lookup gating the 404", () => {
  const spec = buildChannelExistsQuery("c1");
  assert.match(spec.text, /from channels c where c\.id = \$1/);
  assert.deepEqual(spec.values, ["c1"]);
});

test("buildChannelFollowerCountQuery counts channel_follows for the channel", () => {
  const spec = buildChannelFollowerCountQuery("c1");
  assert.match(spec.text, /count\(\*\)::int as followers/);
  assert.match(spec.text, /from channel_follows cf/);
  assert.match(spec.text, /cf\.channel_id = \$1/);
  assert.deepEqual(spec.values, ["c1"]);
});

test("buildChannelFollowerTrendQuery buckets follows by day inside the window", () => {
  const spec = buildChannelFollowerTrendQuery("c1", 30);
  assert.match(spec.text, /from channel_follows cf/);
  assert.match(spec.text, /date_trunc\('day', cf\.created_at\)/);
  assert.match(spec.text, /cf\.created_at >= now\(\) - \(\$2 \|\| ' days'\)::interval/);
  assert.match(spec.text, /group by date_trunc\('day', cf\.created_at\)/);
  assert.match(spec.text, /order by date_trunc\('day', cf\.created_at\) asc/);
  assert.deepEqual(spec.values, ["c1", "30"]);
});

test("buildChannelFollowerPriorsQuery counts follows BEFORE the window opens", () => {
  const spec = buildChannelFollowerPriorsQuery("c1", 30);
  assert.match(spec.text, /count\(\*\)::int as prior/);
  assert.match(spec.text, /cf\.created_at < now\(\) - \(\$2 \|\| ' days'\)::interval/);
  assert.deepEqual(spec.values, ["c1", "30"]);
});

test("buildChannelNotificationAudienceQuery counts only notify=true follows", () => {
  const spec = buildChannelNotificationAudienceQuery("c1");
  assert.match(spec.text, /count\(\*\)::int as audience/);
  assert.match(spec.text, /from channel_follows cf/);
  assert.match(spec.text, /cf\.notify = true/);
  assert.deepEqual(spec.values, ["c1"]);
});

test("buildChannelSeriesPerformanceQuery joins channel series to engagement_events for views + completions", () => {
  const spec = buildChannelSeriesPerformanceQuery("c1");
  assert.match(spec.text, /from series_channels sc/);
  assert.match(spec.text, /join series s on s\.id = sc\.series_id/);
  assert.match(spec.text, /left join engagement_events e on e\.series_id = s\.id/);
  assert.match(spec.text, /filter \(where e\.type = 'play'\)::int as views/);
  assert.match(spec.text, /filter \(where e\.type = 'completion_50'\)::int as completions/);
  assert.match(spec.text, /sc\.channel_id = \$1/);
  assert.match(spec.text, /order by views desc, s\.title asc/);
  assert.deepEqual(spec.values, ["c1"]);
});

test("mapFollowerTrend accumulates per-day adds onto the pre-window prior base", () => {
  const out = mapFollowerTrend(
    [
      { day: "2026-06-01", adds: 3 },
      { day: "2026-06-02", adds: 0 },
      { day: "2026-06-03", adds: 5 },
    ],
    100
  );
  assert.deepEqual(out, [
    { day: "2026-06-01", adds: 3, cumulative: 103 },
    { day: "2026-06-02", adds: 0, cumulative: 103 },
    { day: "2026-06-03", adds: 5, cumulative: 108 },
  ]);
});

test("mapFollowerTrend floors a negative/garbage prior to 0", () => {
  const out = mapFollowerTrend([{ day: "2026-06-01", adds: 2 }], -5);
  assert.deepEqual(out, [{ day: "2026-06-01", adds: 2, cumulative: 2 }]);
});

test("mapChannelSeriesPerformance derives completion = completion_50/play with an honest 0 on no plays", () => {
  const out = mapChannelSeriesPerformance([
    { series_id: "s1", title: "A", views: 200, completions: 50 },
    { series_id: "s2", title: "B", views: 0, completions: 0 },
  ]);
  assert.deepEqual(out, [
    { seriesId: "s1", title: "A", views: 200, completion: 0.25 },
    { seriesId: "s2", title: "B", views: 0, completion: 0 },
  ]);
});

test("composeChannelAnalytics returns null when the channel is absent (404 path)", () => {
  assert.equal(composeChannelAnalytics([], [], [], [], [], []), null);
});

test("composeChannelAnalytics builds the contract shape with brandDeals always empty + unwired", () => {
  const body = composeChannelAnalytics(
    [{ id: "c1" }],
    [{ followers: 120 }],
    [{ day: "2026-06-01", adds: 3 }],
    [{ prior: 100 }],
    [{ audience: 90 }],
    [{ series_id: "s1", title: "A", views: 200, completions: 50 }]
  );
  assert.ok(body);
  assert.equal(body.followers, 120);
  assert.equal(body.notificationAudience, 90);
  assert.deepEqual(body.followerTrend, [{ day: "2026-06-01", adds: 3, cumulative: 103 }]);
  assert.deepEqual(body.seriesPerformance, [
    { seriesId: "s1", title: "A", views: 200, completion: 0.25 },
  ]);
  // Brand deals are never fabricated: empty list, marked unwired.
  assert.deepEqual(body.brandDeals, []);
  assert.equal(body.brandDealsSource, "unwired");
});
