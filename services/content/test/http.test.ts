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
import { freshDb, emptyDb, pgliteContentDb, FIX, TEST_CREATOR } from "./harness.js";
import { sqlOwnership } from "../src/ownership.js";
import { createContentApp } from "../src/http/app.js";
import type { Hono } from "hono";

// Test sessions: "session:<uuid>" is a valid session for that user; anything else is signed out.
const testSessions = {
  verifySession: async (t: string | null) => {
    const m = /^session:([0-9a-f-]{36})$/i.exec(t ?? "");
    return m ? { userId: m[1] } : null;
  },
};
const asUser = (id: string) => `Bearer session:${id}`;
const OTHER_CREATOR = "aaaaaaaa-0000-0000-0000-000000000002";

// The content app with creator auth wired to the real SQL ownership checks. Requests act as TEST_CREATOR
// unless they set their own authorization header (or "" for signed out).
function appFor(db: Awaited<ReturnType<typeof freshDb>>, opts: { serviceSecret?: string } = {}): Hono {
  const app = createContentApp({
    db: pgliteContentDb(db),
    auth: {
      session: testSessions,
      ownership: sqlOwnership((sql, params) => db.query(sql, params) as never),
      ...(opts.serviceSecret ? { serviceSecret: opts.serviceSecret } : {}),
    },
  });
  const request = app.request.bind(app);
  app.request = ((input: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has("authorization")) headers.set("authorization", asUser(TEST_CREATOR));
    if (headers.get("authorization") === "") headers.delete("authorization");
    return request(input, { ...init, headers });
  }) as typeof app.request;
  return app;
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

// ---------- GET /series : ALL series incl drafts ----------

test("GET /series lists drafts and published series both (unlike /feed)", async () => {
  const app = appFor(await emptyDb());
  // Two fresh series, both drafts.
  const a = (await (await app.request("/series", json({ title: "Draft One" }))).json()) as { id: string };
  await app.request("/series", json({ title: "Draft Two" }));
  // /feed is empty (nothing published) but /series shows both drafts.
  assert.deepEqual(((await (await app.request("/feed")).json()) as { series: unknown[] }).series, []);
  const all = (await (await app.request("/series")).json()) as { series: { id: string; title: string; published_at: string | null }[] };
  assert.equal(all.series.length, 2);
  assert.ok(all.series.every((s) => s.published_at == null));
  assert.ok(all.series.some((s) => s.id === a.id && s.title === "Draft One"));
});

// ---------- PATCH /series/{id} : rename / update ----------

test("PATCH /series/{id} renames a series and leaves other fields intact", async () => {
  const app = appFor(await emptyDb());
  const created = (await (
    await app.request("/series", json({ title: "Working Title", genre: "thriller" }))
  ).json()) as { id: string };

  const res = await app.request(`/series/${created.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "The Real Title" }),
  });
  assert.equal(res.status, 200);
  const row = (await res.json()) as { title: string; genre: string | null };
  assert.equal(row.title, "The Real Title");
  // COALESCE keeps the genre we did not send.
  assert.equal(row.genre, "thriller");
});

test("PATCH /series/{id} rejects an empty title and unknown series", async () => {
  const app = appFor(await freshDb());
  const empty = await app.request(`/series/${FIX.series}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "   " }),
  });
  assert.equal(empty.status, 400);
  assert.equal(((await empty.json()) as { error: string }).error, "invalid_title");

  const missing = await app.request("/series/99999999-9999-9999-9999-999999999999", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Nope" }),
  });
  assert.equal(missing.status, 404);
  assert.equal(((await missing.json()) as { error: string }).error, "series_not_found");
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

// ---------------- creator auth + ownership ----------------

test("writes need a signed-in creator: signed out is 401 and nothing is created", async () => {
  const app = appFor(await emptyDb());
  const res = await app.request("/series", { ...json({ title: "Nope" }), headers: { "content-type": "application/json", authorization: "" } });
  assert.equal(res.status, 401);
  const forged = await app.request("/series", { ...json({ title: "Nope" }), headers: { "content-type": "application/json", authorization: "Bearer demo-session-token" } });
  assert.equal(forged.status, 401);
});

test("a creator cannot change another creator's series (403 on every write route)", async () => {
  const app = appFor(await freshDb());
  const other = { "content-type": "application/json", authorization: asUser(OTHER_CREATOR) };
  const attempts: Array<[string, RequestInit]> = [
    [`/series/${FIX.series}/publish`, { method: "POST", headers: other }],
    [`/series/${FIX.series}/unpublish`, { method: "POST", headers: other }],
    [`/series/${FIX.series}`, { method: "PATCH", headers: other, body: JSON.stringify({ title: "pwned" }) }],
    [`/series/${FIX.series}/poster`, { method: "PATCH", headers: other, body: JSON.stringify({ poster_url: "https://x/p.png", provenance: {} }) }],
    [`/variants/${FIX.variantEnding}`, { method: "DELETE", headers: other }],
    [`/variants/${FIX.variantEnding}/tracks`, { method: "PATCH", headers: other, body: JSON.stringify({ caption_doc_url: "https://x/c.json" }) }],
  ];
  for (const [path, init] of attempts) {
    const res = await app.request(path, init);
    assert.equal(res.status, 403, `${init.method} ${path}`);
  }
  // The owner can.
  assert.equal((await app.request(`/series/${FIX.series}/unpublish`, { method: "POST" })).status, 200);
});

test("creating a series records the creator as owner; the studio list shows only their series", async () => {
  const app = appFor(await freshDb());
  const created = await app.request("/series", { ...json({ title: "Mine", base_language: "en" }), headers: { "content-type": "application/json", authorization: asUser(OTHER_CREATOR) } });
  assert.equal(created.status, 201);
  const { id } = (await created.json()) as { id: string };
  const theirs = (await (await app.request("/series", { headers: { authorization: asUser(OTHER_CREATOR) } })).json()) as { series: Array<{ id: string }> };
  assert.deepEqual(theirs.series.map((s) => s.id), [id]);
  const mine = (await (await app.request("/series")).json()) as { series: Array<{ id: string }> };
  assert.ok(!mine.series.some((s) => s.id === id), "another creator's draft is not listed");
  assert.equal((await app.request("/series", { headers: { authorization: "" } })).status, 401);
});

test("draft graphs are private to the owner; published graphs are public", async () => {
  const app = appFor(await freshDb());
  const created = await app.request("/series", { ...json({ title: "Draft", base_language: "en" }), headers: { "content-type": "application/json", authorization: asUser(OTHER_CREATOR) } });
  const { id } = (await created.json()) as { id: string };
  assert.equal((await app.request(`/series/${id}/graph`, { headers: { authorization: "" } })).status, 404);
  assert.equal((await app.request(`/series/${id}/graph`)).status, 404, "another creator cannot read the draft");
  assert.notEqual((await app.request(`/series/${id}/graph`, { headers: { authorization: asUser(OTHER_CREATOR) } })).status, 404);
  await app.request(`/series/${id}/publish`, { method: "POST", headers: { authorization: asUser(OTHER_CREATOR) } });
  assert.equal((await app.request(`/series/${id}/graph`, { headers: { authorization: "" } })).status, 200);
});

test("admin routes require the service secret when one is configured", async () => {
  const app = appFor(await freshDb(), { serviceSecret: "svc-secret" });
  assert.equal((await app.request("/admin/ads-today/aaaaaaaa-0000-0000-0000-000000000001")).status, 403);
  const ok = await app.request("/admin/ads-today/aaaaaaaa-0000-0000-0000-000000000001", { headers: { authorization: "Bearer svc-secret" } });
  assert.notEqual(ok.status, 403);
});

test("writes fail closed with 503 when creator auth is not configured", async () => {
  const app = createContentApp({ db: pgliteContentDb(await emptyDb()) });
  const res = await app.request("/series", json({ title: "x" }));
  assert.equal(res.status, 503);
});
