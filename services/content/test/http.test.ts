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

// ---------- DELETE /variants/{id} ----------

test("DELETE /variants/{id} removes a variant and is idempotent (200 then 404)", async () => {
  const app = appFor(await freshDb());
  // Create a fresh variant on the cold-open beat, then delete it over the route.
  const created = (await (
    await app.request("/variants", json({ beat_id: FIX.beatColdOpen, tier: "A_filmed", playback_url: "https://cdn/del.m3u8" }))
  ).json()) as { id: string };

  const del = await app.request(`/variants/${created.id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  assert.deepEqual(await del.json(), { id: created.id, deleted: true });

  // The graph no longer carries it.
  const g = (await (await app.request(`/series/${FIX.series}/graph`)).json()) as {
    episodes: { beats: { variants: { id: string }[] }[] }[];
  };
  const stillThere = g.episodes[0].beats.some((b) => b.variants.some((v) => v.id === created.id));
  assert.equal(stillThere, false);

  // Deleting again is a clean 404, not a 500.
  const again = await app.request(`/variants/${created.id}`, { method: "DELETE" });
  assert.equal(again.status, 404);
  assert.equal(((await again.json()) as { error: string }).error, "variant_not_found");
});

test("DELETE /variants/{id} rejects a malformed id with 400", async () => {
  const app = appFor(await freshDb());
  const res = await app.request("/variants/not-a-uuid", { method: "DELETE" });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, "invalid_variant_id");
});

// ---------- publish / feed (0009b) ----------

test("publish puts a series on the feed; unpublish removes it", async () => {
  const app = appFor(await freshDb());
  // Draft: not on the feed.
  assert.deepEqual(((await (await app.request("/feed")).json()) as { series: unknown[] }).series, []);

  const pub = await app.request(`/series/${FIX.series}/publish`, { method: "POST" });
  assert.equal(pub.status, 200);
  assert.ok(((await pub.json()) as { published_at: string }).published_at);

  const feed = (await (await app.request("/feed")).json()) as { series: { id: string }[] };
  assert.equal(feed.series.length, 1);
  assert.equal(feed.series[0].id, FIX.series);

  const un = await app.request(`/series/${FIX.series}/unpublish`, { method: "POST" });
  assert.equal(un.status, 200);
  assert.equal(((await un.json()) as { published_at: string | null }).published_at, null);
  assert.deepEqual(((await (await app.request("/feed")).json()) as { series: unknown[] }).series, []);
});

test("publish on an unknown series is 404", async () => {
  const app = appFor(await freshDb());
  const res = await app.request("/series/99999999-9999-9999-9999-999999999999/publish", { method: "POST" });
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { error: string }).error, "series_not_found");
});

// ---------- variant tracks (0009a) ----------

test("PATCH /variants/{id}/tracks attaches accessibility track URLs", async () => {
  const app = appFor(await freshDb());
  const created = (await (
    await app.request("/variants", json({ beat_id: FIX.beatColdOpen, tier: "A_filmed", playback_url: "https://cdn/x.m3u8" }))
  ).json()) as { id: string };
  const res = await app.request(`/variants/${created.id}/tracks`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caption_doc_url: "https://ax/cap.json", dub_audio_urls: { es: "https://ax/es.mp3" } }),
  });
  assert.equal(res.status, 200);
  const row = (await res.json()) as { caption_doc_url: string; dub_audio_urls: Record<string, string> };
  assert.equal(row.caption_doc_url, "https://ax/cap.json");
  assert.deepEqual(row.dub_audio_urls, { es: "https://ax/es.mp3" });
});

// ---------- poster (0009c) ----------

test("PATCH /series/{id}/poster stores the poster url", async () => {
  const app = appFor(await freshDb());
  const res = await app.request(`/series/${FIX.series}/poster`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ poster_url: "https://posters/ls.png", provenance: { c2pa: true, synthetic: true } }),
  });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { poster_url: string }).poster_url, "https://posters/ls.png");
  // The graph read now carries it.
  const g = (await (await app.request(`/series/${FIX.series}/graph`)).json()) as { series: { poster_url: string } };
  assert.equal(g.series.poster_url, "https://posters/ls.png");
});
