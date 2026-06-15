// Route tests for the content HTTP adapter, exercising the real Hono app over the real content handlers
// on PGlite (the same migrations + seed the handler suite uses). These prove the transport and contract
// wiring, not the graph math (handlers.test.ts covers that):
//
//   - GET /series/{id}/graph resolves the seeded walking-skeleton into a 200 graph.
//   - GET /series/{id}/graph is 404 for an unknown id and for a malformed id (no DB touch).
//   - the create* POSTs round-trip through the routes and build a graph the read route resolves.
//   - server-authoritative defaults survive the transport (is_free false, coin_cost 0 when omitted).
//   - bad enums and bad payloads map to 400; malformed JSON maps to 400, not 500.
//
// The content contract documents no auth for these authoring routes, so there is no token plumbing here.
// No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, emptyDb, pgliteContentDb, FIX } from "./harness.js";
import { createContentApp } from "../src/http/app.js";
import type { Hono } from "hono";

function appFor(db: Awaited<ReturnType<typeof freshDb>>): Hono {
  return createContentApp({ db: pgliteContentDb(db) });
}

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// ---------- GET /series/{id}/graph ----------

test("GET /series/{id}/graph resolves the seeded walking-skeleton series", async () => {
  const app = appFor(await freshDb());
  const res = await app.request(`/series/${FIX.series}/graph`);
  assert.equal(res.status, 200);
  const g = (await res.json()) as {
    series: { id: string; title: string; genre: string | null };
    episodes: { id: string; beats: { variants: unknown[] }[] }[];
    edges: unknown[];
  };
  assert.equal(g.series.id, FIX.series);
  assert.equal(g.series.title, "The Last Signal");
  assert.equal(g.episodes.length, 1);
  assert.equal(g.episodes[0].beats.length, 5);
  const totalVariants = g.episodes[0].beats.reduce((n, b) => n + b.variants.length, 0);
  assert.equal(totalVariants, 6);
  assert.equal(g.edges.length, 5);
});

test("GET /series/{id}/graph returns 404 for an unknown series", async () => {
  const app = appFor(await freshDb());
  const res = await app.request("/series/99999999-9999-9999-9999-999999999999/graph");
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { error: string }).error, "series_not_found");
});

test("GET /series/{id}/graph returns 404 for a malformed id without touching the DB", async () => {
  const app = appFor(await freshDb());
  const res = await app.request("/series/not-a-uuid/graph");
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { error: string }).error, "series_not_found");
});

// ---------- the create* routes build a graph the read route resolves ----------

test("the create routes build a graph the read route resolves identically", async () => {
  const app = appFor(await emptyDb());

  const series = (await (await app.request("/series", json({ title: "Built Series", genre: "thriller" }))).json()) as {
    id: string;
  };
  const ep = (await (
    await app.request("/episodes", json({ series_id: series.id, episode_number: 1, title: "Pilot", is_free: true }))
  ).json()) as { id: string };

  const beatIds: string[] = [];
  const beatSpecs = [
    { beat_index: 0, role: "cold_open" },
    { beat_index: 1, role: "spine", is_branch_point: true },
    { beat_index: 2, role: "variant" },
    { beat_index: 2, role: "variant" },
    { beat_index: 3, role: "ending" },
  ];
  for (const spec of beatSpecs) {
    const r = await app.request("/beats", json({ series_id: series.id, episode_id: ep.id, ...spec }));
    assert.equal(r.status, 201);
    beatIds.push(((await r.json()) as { id: string }).id);
  }

  for (const id of beatIds) {
    const r = await app.request("/variants", json({ beat_id: id, tier: "A_filmed", playback_url: `https://cdn/${id}.m3u8` }));
    assert.equal(r.status, 201);
  }
  // premium alternate ending on the last beat
  const premium = await app.request(
    "/variants",
    json({ beat_id: beatIds[4], tier: "A_filmed", is_premium: true, coin_cost: 5, playback_url: "https://cdn/premium.m3u8" })
  );
  assert.equal(premium.status, 201);

  const edges = [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
    { from: 1, to: 3 },
    { from: 2, to: 4 },
    { from: 3, to: 4 },
  ];
  for (const e of edges) {
    const r = await app.request("/edges", json({ from_beat_id: beatIds[e.from], to_beat_id: beatIds[e.to] }));
    assert.equal(r.status, 201);
  }

  const res = await app.request(`/series/${series.id}/graph`);
  assert.equal(res.status, 200);
  const g = (await res.json()) as { episodes: { beats: { variants: unknown[] }[] }[]; edges: unknown[] };
  assert.equal(g.episodes.length, 1);
  assert.equal(g.episodes[0].beats.length, 5);
  assert.equal(g.episodes[0].beats.reduce((n, b) => n + b.variants.length, 0), 6);
  assert.equal(g.edges.length, 5);
});

// ---------- server-authoritative defaults survive the transport ----------

test("POST /episodes applies server defaults (is_free false, coin_cost 0) over the transport", async () => {
  const app = appFor(await freshDb());
  const series = (await (await app.request("/series", json({ title: "Defaults" }))).json()) as { id: string };
  const res = await app.request("/episodes", json({ series_id: series.id, episode_number: 2 }));
  assert.equal(res.status, 201);
  const ep = (await res.json()) as { is_free: boolean; coin_cost: number };
  assert.equal(ep.is_free, false);
  assert.equal(ep.coin_cost, 0);
});

// ---------- validation maps to 400 ----------

test("POST /series with an empty title is 400", async () => {
  const app = appFor(await freshDb());
  const res = await app.request("/series", json({ title: "   " }));
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, "invalid_title");
});

test("POST /beats with a bad role enum is 400", async () => {
  const app = appFor(await freshDb());
  const res = await app.request(
    "/beats",
    json({ series_id: FIX.series, episode_id: FIX.episode, beat_index: 0, role: "villain" })
  );
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, "invalid_role");
});

test("POST /beats with a series that does not match the episode is 400 (series_episode_mismatch)", async () => {
  const app = appFor(await freshDb());
  const other = (await (await app.request("/series", json({ title: "Other" }))).json()) as { id: string };
  const res = await app.request(
    "/beats",
    json({ series_id: other.id, episode_id: FIX.episode, beat_index: 7, role: "spine" })
  );
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, "series_episode_mismatch");
});

test("POST /edges rejects a self edge with 400", async () => {
  const app = appFor(await freshDb());
  const res = await app.request("/edges", json({ from_beat_id: FIX.beatColdOpen, to_beat_id: FIX.beatColdOpen }));
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, "self_edge");
});

test("a malformed JSON body is 400, not a 500", async () => {
  const app = appFor(await freshDb());
  const res = await app.request("/series", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ not json",
  });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, "invalid_json");
});
