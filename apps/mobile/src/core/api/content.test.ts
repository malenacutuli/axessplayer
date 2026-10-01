import { test } from "node:test";
import assert from "node:assert/strict";
import { createContentClient } from "./content";
import { parseVideo, parseHomeFeed } from "./parse";
import { createMockContentClient, MOCK_VIDEOS } from "./mocks";
import { recordingFetch } from "../test-fetch";

const VIDEO = {
  id: "v1",
  title: "Hello",
  description: null,
  channel: { id: "c1", name: "Chan" },
  orientation: "vertical",
  width: 1080,
  height: 1920,
  duration_ms: 30000,
  format: "short",
  language: "en",
  category: null,
  thumbnail_url: null,
  published_at: "2026-10-01T00:00:00Z",
  accessibility: { captions: true, audio_description: false, sign: true, dubs: ["es"] },
  sponsor: { brand: "Acme", disclosure: "Paid partnership" },
};

test("guest requests carry NO Authorization header", async () => {
  const { fetchImpl, calls } = recordingFetch(() => ({ status: 200, body: { items: [VIDEO], next_cursor: null } }));
  const c = createContentClient("https://content.test/", { getAccessToken: () => null, fetch: fetchImpl });
  const r = await c.getShorts();
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, "https://content.test/feed/shorts");
  assert.equal("authorization" in calls[0].headers, false);
});

test("signed-in requests carry Bearer <supabase access token>", async () => {
  const { fetchImpl, calls } = recordingFetch(() => ({ status: 200, body: VIDEO }));
  const c = createContentClient("https://content.test", { getAccessToken: async () => "tok123", fetch: fetchImpl });
  await c.getVideo("v 1");
  assert.equal(calls[0].headers.authorization, "Bearer tok123");
  assert.equal(calls[0].url, "https://content.test/videos/v%201");
});

test("cursor is passed opaque and url-encoded", async () => {
  const { fetchImpl, calls } = recordingFetch(() => ({ status: 200, body: { items: [], next_cursor: null } }));
  const c = createContentClient("https://content.test", { getAccessToken: () => null, fetch: fetchImpl });
  await c.getShorts("a+b/c=");
  assert.equal(calls[0].url, "https://content.test/feed/shorts?cursor=a%2Bb%2Fc%3D");
});

test("404 degrades to not_found, network failure to network, never throws", async () => {
  const nf = recordingFetch(() => ({ status: 404, body: { error: "nope" } }));
  const c1 = createContentClient("https://c", { getAccessToken: () => null, fetch: nf.fetchImpl });
  assert.deepEqual(await c1.getHome(), { ok: false, reason: "not_found", status: 404 });
  const down = recordingFetch(() => "throw");
  const c2 = createContentClient("https://c", { getAccessToken: () => null, fetch: down.fetchImpl });
  assert.deepEqual(await c2.getPlayback("x"), { ok: false, reason: "network" });
});

test("a throwing token provider is treated as signed out", async () => {
  const { fetchImpl, calls } = recordingFetch(() => ({ status: 200, body: { playback_url: "https://cdn/x.m3u8" } }));
  const c = createContentClient("https://c", { getAccessToken: () => { throw new Error("storage"); }, fetch: fetchImpl });
  const r = await c.getPlayback("x");
  assert.deepEqual(r, { ok: true, data: { playback_url: "https://cdn/x.m3u8" } });
  assert.equal("authorization" in calls[0].headers, false);
});

test("parseVideo keeps a full video and drops one without id/title", () => {
  const v = parseVideo(VIDEO);
  assert.ok(v);
  assert.equal(v.sponsor?.brand, "Acme");
  assert.deepEqual(v.accessibility.dubs, ["es"]);
  assert.equal(parseVideo({ title: "x" }), null);
});

test("parseVideo infers orientation and format from dimensions when missing", () => {
  const v = parseVideo({ id: "a", title: "b", width: 720, height: 720 });
  assert.equal(v?.orientation, "square");
  assert.equal(v?.format, "long");
  assert.equal(v?.accessibility.captions, false);
  const vert = parseVideo({ id: "a", title: "b", orientation: null, format: null, width: 720, height: 1280, duration_ms: 60000 });
  assert.equal(vert?.orientation, "vertical");
  assert.equal(vert?.format, "short");
  const longVert = parseVideo({ id: "a", title: "b", width: 720, height: 1280, duration_ms: 600000 });
  assert.equal(longVert?.format, "long");
});

test("parseHomeFeed drops malformed and empty rows", () => {
  const h = parseHomeFeed({ rows: [{ id: "r1", title: "Row", items: [VIDEO, { bad: true }] }, { id: "r2", title: "Empty", items: [] }, "junk"] });
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].items.length, 1);
});

test("mock client pages shorts by cursor until null", async () => {
  const m = createMockContentClient(MOCK_VIDEOS, 2);
  const p1 = await m.getShorts(null);
  assert.ok(p1.ok);
  assert.equal(p1.data.items.length, 2);
  const p2 = await m.getShorts(p1.data.next_cursor);
  assert.ok(p2.ok);
  assert.equal(p2.data.next_cursor, null);
  assert.equal((await m.getVideo("missing")).ok, false);
});
