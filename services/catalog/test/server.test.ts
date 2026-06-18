// Route + cutover-gate tests for the catalog server. Drives route() and selectVerifiers() directly with a
// FAKE pg and the TEST verifier, so the trust boundary (401 on missing/invalid bearer), the production
// cutover gate (hard throw), the trending sparse-events fallback selection, and the 404/400 paths are
// covered without a socket or a database. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { route, selectVerifiers } from "../src/server.js";
import { testVerifiers, type Verifiers } from "../src/http/auth.js";
import type { Queryable } from "../src/queries.js";

const SESSION = "11111111-1111-1111-1111-111111111111";
const BEARER = `Bearer session:${SESSION}`;

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

function urlOf(path: string): URL {
  return new URL(path, "http://catalog.local");
}

const verifiers: Verifiers = testVerifiers();

// --- cutover gate ----------------------------------------------------------------------------------

test("selectVerifiers throws under NODE_ENV=production (cutover gate)", () => {
  assert.throws(
    () => selectVerifiers({ databaseUrl: "x", nodeEnv: "production" }),
    /cutover gate/
  );
});

test("selectVerifiers returns the test verifier outside production", () => {
  const v = selectVerifiers({ databaseUrl: "x", nodeEnv: "development" });
  assert.ok(v.session);
});

// --- trust boundary --------------------------------------------------------------------------------

test("POST /calibrate without a bearer is 401", async () => {
  const { db, calls } = fakePg([]);
  const res = await route(db, verifiers, "POST", urlOf("/calibrate"), null, {
    pace: "tense",
    pov: "maya",
    intensity: 3,
  });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("POST /calibrate with a valid bearer writes once and returns the badge", async () => {
  const { db, calls } = fakePg([[{ preference_vector: {} }]]);
  const res = await route(db, verifiers, "POST", urlOf("/calibrate"), BEARER, {
    pace: "tense",
    pov: "maya",
    intensity: 3,
  });
  assert.equal(res.status, 200);
  assert.equal((res.body as { badge: string }).badge, "CUT FOR YOU");
  assert.equal(calls.length, 1);
  // The verified session subject is the first value, never taken from the body.
  assert.equal(calls[0].values[0], SESSION);
});

test("POST /calibrate with an invalid body is 400 and writes nothing", async () => {
  const { db, calls } = fakePg([]);
  const res = await route(db, verifiers, "POST", urlOf("/calibrate"), BEARER, { pace: "nope" });
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test("GET /continue without a bearer is 401", async () => {
  const { db } = fakePg([]);
  const res = await route(db, verifiers, "GET", urlOf("/continue"), null, undefined);
  assert.equal(res.status, 401);
});

// --- trending fallback selection -------------------------------------------------------------------

test("GET /trending falls back to published series when events are sparse", async () => {
  // First query (aggregation) returns 1 row; fallback returns 3 rows -> fallback wins.
  const { db, calls } = fakePg([
    [{ series_id: "s1", title: "A", poster: null, genre: null }],
    [
      { series_id: "p1", title: "P1", poster: null, genre: null },
      { series_id: "p2", title: "P2", poster: null, genre: null },
      { series_id: "p3", title: "P3", poster: null, genre: null },
    ],
  ]);
  const res = await route(db, verifiers, "GET", urlOf("/trending"), null, undefined);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
  assert.equal((res.body as unknown[]).length, 3);
});

test("GET /trending keeps the aggregation when it is healthy (no fallback query)", async () => {
  const { db, calls } = fakePg([
    [
      { series_id: "s1", title: "A", poster: null, genre: null },
      { series_id: "s2", title: "B", poster: null, genre: null },
      { series_id: "s3", title: "C", poster: null, genre: null },
    ],
  ]);
  const res = await route(db, verifiers, "GET", urlOf("/trending"), null, undefined);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal((res.body as unknown[]).length, 3);
});

// --- series detail + search + 404 ------------------------------------------------------------------

test("GET /series/:id/detail composes header + episodes + a11y (3 queries)", async () => {
  const { db, calls } = fakePg([
    [{ id: "s1", title: "Show", poster: "p", genre: "Crime", format: "Series" }],
    [{ id: "e1", number: 1, coin_cost: 0, locked: false }],
    [{ has_cc: true, has_ad: true, has_sign: false, lang_count: 2, endings_count: 3 }],
  ]);
  const res = await route(db, verifiers, "GET", urlOf("/series/s1/detail"), null, undefined);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 3);
  const body = res.body as { endingsCount: number; a11y: { cc: boolean } };
  assert.equal(body.endingsCount, 3);
  assert.equal(body.a11y.cc, true);
});

test("GET /series/:id/detail is 404 when the series is unknown", async () => {
  const { db } = fakePg([[], [], []]);
  const res = await route(db, verifiers, "GET", urlOf("/series/nope/detail"), null, undefined);
  assert.equal(res.status, 404);
});

test("GET /series/:id/cuts runs one query and returns grouped per-beat cuts (200, unauthed)", async () => {
  const { db, calls } = fakePg([
    [
      {
        beat_id: "b1",
        beat_index: 4,
        beat_role: "climax",
        variant_id: "v1",
        variant_kind: "alt_ending",
        axis: "ending",
        axis_value: "Hopeful Ending",
        coin_cost: 50,
        is_premium: true,
      },
    ],
  ]);
  const res = await route(db, verifiers, "GET", urlOf("/series/s1/cuts"), null, undefined);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values[0], "s1");
  const body = res.body as Array<{ beatId: string; beatLabel: string; cuts: unknown[] }>;
  assert.equal(body.length, 1);
  assert.equal(body[0].beatId, "b1");
  assert.equal(body[0].beatLabel, "Climax (Beat 4)");
  assert.equal(body[0].cuts.length, 1);
});

test("GET /series/:id/cuts returns an empty array when there are no cut-bearing variants", async () => {
  const { db } = fakePg([[]]);
  const res = await route(db, verifiers, "GET", urlOf("/series/s1/cuts"), null, undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test("GET /search with an empty q short-circuits to empty arrays (no query)", async () => {
  const { db, calls } = fakePg([]);
  const res = await route(db, verifiers, "GET", urlOf("/search?q="), null, undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { shows: [], characters: [], channels: [] });
  assert.equal(calls.length, 0);
});

test("GET /search?q= runs the three search queries", async () => {
  const { db, calls } = fakePg([
    [{ series_id: "s1", title: "Luz", poster: null, genre: null }],
    [{ name: "Maya", series_id: "s1" }],
    [{ id: "c1", slug: "crime", name: "Crime" }],
  ]);
  const res = await route(db, verifiers, "GET", urlOf("/search?q=luz"), null, undefined);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 3);
  const body = res.body as { shows: unknown[]; characters: unknown[]; channels: unknown[] };
  assert.equal(body.shows.length, 1);
  assert.equal(body.characters.length, 1);
  assert.equal(body.channels.length, 1);
});

test("an unknown route is 404", async () => {
  const { db } = fakePg([]);
  const res = await route(db, verifiers, "GET", urlOf("/nope"), null, undefined);
  assert.equal(res.status, 404);
});

// --- creator-scoped endpoints (session-authed) -----------------------------------------------------

test("GET /series/:id/graph without a creator bearer is 401 (no db read)", async () => {
  const { db, calls } = fakePg([]);
  const res = await route(db, verifiers, "GET", urlOf("/series/s1/graph"), null, undefined);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("GET /series/:id/graph with a valid bearer but unknown series is 404", async () => {
  // exists -> empty; the other three reads still run in parallel, then composeSeriesGraph returns null.
  const { db } = fakePg([[], [], [], []]);
  const res = await route(db, verifiers, "GET", urlOf("/series/ghost/graph"), BEARER, undefined);
  assert.equal(res.status, 404);
});

test("GET /series/:id/graph with a valid bearer composes the graph (200) and runs canon", async () => {
  const { db } = fakePg([
    [{ id: "s1" }], // exists
    [
      { id: "a", episode_id: "e1", beat_index: 0, role: "spine", is_branch_point: false },
      { id: "z", episode_id: "e1", beat_index: 1, role: "ending", is_branch_point: false },
    ], // beats
    [
      { beat_id: "a", any_premium: false, any_branch: false, any_ending: false, any_locked: false, min_premium_cost: null, axis_kind: null },
      { beat_id: "z", any_premium: false, any_branch: false, any_ending: true, any_locked: false, min_premium_cost: null, axis_kind: null },
    ], // flags
    [{ from_beat_id: "a", to_beat_id: "z", condition: null }], // edges
  ]);
  const res = await route(db, verifiers, "GET", urlOf("/series/s1/graph"), BEARER, undefined);
  assert.equal(res.status, 200);
  const body = res.body as { nodes: unknown[]; edges: unknown[]; canon: { valid: boolean } };
  assert.equal(body.nodes.length, 2);
  assert.equal(body.edges.length, 1);
  assert.equal(body.canon.valid, true);
});

test("GET /series/:id/analytics without a creator bearer is 401 (no db read)", async () => {
  const { db, calls } = fakePg([]);
  const res = await route(db, verifiers, "GET", urlOf("/series/s1/analytics"), null, undefined);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("GET /series/:id/analytics with a valid bearer but unknown series is 404 (only the exists read)", async () => {
  const { db, calls } = fakePg([[]]);
  const res = await route(db, verifiers, "GET", urlOf("/series/ghost/analytics"), BEARER, undefined);
  assert.equal(res.status, 404);
  assert.equal(calls.length, 1); // short-circuits after the existence check
});

test("GET /series/:id/analytics with a valid bearer aggregates (200) with lift as a band", async () => {
  const { db } = fakePg([
    [{ id: "s1" }], // exists
    [{ beat_id: "b1", started: 100, skipped: 10 }], // retention
    [{ beat_id: "b1", treatment_trials: 10000, treatment_success: 8000, control_trials: 10000, control_success: 5000 }], // branch
    [{ beat_id: "z1", completions: 50 }], // endings
    [{ impression: 1000, play: 500, completion_50: 250, episode_completed: 100, unlock_purchased: 5 }], // funnel
    [{ plays: 200, completions: 50, watch_ms: 9999 }], // completion
    [{ cohort_id: "earlybird", play: 100, completion_50: 40, episode_completed: 10 }], // cohort
  ]);
  const res = await route(db, verifiers, "GET", urlOf("/series/s1/analytics"), BEARER, undefined);
  assert.equal(res.status, 200);
  const body = res.body as {
    beatRetention: Array<{ retention: number }>;
    branchPerformance: Array<{ lift: { low: number; high: number; center: number }; direction: string }>;
    completion: number;
  };
  assert.equal(body.beatRetention[0].retention, 0.9);
  // lift is a band object, never a bare number.
  const lift = body.branchPerformance[0].lift;
  assert.ok(typeof lift.low === "number" && typeof lift.high === "number" && typeof lift.center === "number");
  assert.equal(body.branchPerformance[0].direction, "up");
  assert.equal(body.completion, 0.25);
});

// --- creator-scoped revenue endpoint (session-authed, 70/30 split) ---------------------------------

test("GET /series/:id/revenue without a creator bearer is 401 (no db read)", async () => {
  const { db, calls } = fakePg([]);
  const res = await route(db, verifiers, "GET", urlOf("/series/s1/revenue"), null, undefined);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("GET /series/:id/revenue with a valid bearer but unknown series is 404 (only the exists read)", async () => {
  const { db, calls } = fakePg([[]]);
  const res = await route(db, verifiers, "GET", urlOf("/series/ghost/revenue"), BEARER, undefined);
  assert.equal(res.status, 404);
  assert.equal(calls.length, 1); // short-circuits after the existence check
});

test("GET /series/:id/revenue with a valid bearer returns the 70/30 split (200)", async () => {
  const { db } = fakePg([
    [{ id: "s1" }], // exists
    [
      { source: "unlock", gross: 100 },
      { source: "rewarded_ad", gross: 33 },
    ], // bySource
    [{ episode_id: "e1", gross: 90 }], // byEpisode
    [{ cohort_id: "high_intent", gross: 133 }], // byCohort
    [{ gross: 133 }], // payout balance read
  ]);
  const res = await route(db, verifiers, "GET", urlOf("/series/s1/revenue"), BEARER, undefined);
  assert.equal(res.status, 200);
  const body = res.body as {
    totalGross: number;
    creator70: number;
    platform30: number;
    payoutBalance: number;
    bySource: Array<{ source: string; creatorShare: number; platformShare: number }>;
  };
  assert.equal(body.totalGross, 133);
  assert.equal(body.creator70, 93);
  assert.equal(body.platform30, 40);
  assert.equal(body.creator70 + body.platform30, body.totalGross); // no rounding leak
  assert.equal(body.payoutBalance, 93);
  assert.equal(body.bySource[0].creatorShare, 70);
  assert.equal(body.bySource[0].platformShare, 30);
});
