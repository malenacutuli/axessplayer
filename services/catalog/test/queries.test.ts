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
  buildContinueQuery,
  buildSearchChannelsQuery,
  buildSearchCharactersQuery,
  buildSearchShowsQuery,
  buildSeriesA11yQuery,
  buildSeriesEpisodesQuery,
  buildSeriesHeaderQuery,
  buildTrendingFallbackQuery,
  buildTrendingQuery,
  calibratePayoff,
  calibrationVector,
  composeSeriesDetail,
  likePattern,
  mapContinueRows,
  mapSearchResults,
  mapTrendingRows,
  parseCalibrateInput,
  TRENDING_EVENT_TYPES,
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

test("a builder spec round-trips through the fake pg query() unchanged", async () => {
  const { db, calls } = fakePg([[{ id: "s1", title: "Show", poster: null, genre: null, format: "Film" }]]);
  const spec = buildSeriesHeaderQuery("s1");
  const r = await db.query(spec.text, spec.values);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, spec.text);
  assert.deepEqual(calls[0].values, ["s1"]);
  assert.equal(r.rows[0].format, "Film");
});
