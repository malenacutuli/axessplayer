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
