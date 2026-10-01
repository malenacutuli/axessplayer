// Spec for standalone creator videos (platform v2, phase 1) over a real Postgres (PGlite) and the real HTTP
// app: upload, Stream ready -> orientation/format/captions, draft privacy, publish, both feeds, signed
// playback, owner-only edits. Stream is a fake; webhooks are signed like Stream signs them. No em dashes.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { freshDb, pgliteContentDb, TEST_CREATOR } from "./harness.js";
import { createContentApp } from "../src/http/app.js";
import { sqlOwnership } from "../src/ownership.js";
import { sqlMediaStore } from "../src/mediaStore.js";
import { sqlVideoStore, orientationOf, formatOf, encodeCursor, decodeCursor } from "../src/videos.js";
import { verifyStreamSignature, type StreamApi } from "../src/stream.js";

const OTHER = "aaaaaaaa-0000-0000-0000-000000000002";
const SECRET = "whs";
const as = (id: string) => `Bearer session:${id}`;

function setup(db: Awaited<ReturnType<typeof freshDb>>, withStream = true) {
  let n = 0;
  const captions: Array<{ uid: string; lang: string }> = [];
  const stream: StreamApi = {
    async createDirectUpload() {
      n++;
      return { uid: `vid${n}`, uploadUrl: `https://upload.example/tus/vid${n}` };
    },
    async copyFromUrl() {
      return { uid: "x" };
    },
    signPlaybackUrl: (hls, uid) => hls.replace(uid, `signed-${uid}`),
    verifyWebhook: (raw, h) => verifyStreamSignature(raw, h, SECRET, Math.floor(Date.now() / 1000)),
    async generateCaptions(uid, lang) {
      captions.push({ uid, lang });
      return true;
    },
  };
  const q = (sql: string, params: unknown[]) => db.query(sql, params) as never;
  const app = createContentApp({
    db: pgliteContentDb(db),
    media: sqlMediaStore(q),
    videos: sqlVideoStore(q),
    ...(withStream ? { stream } : {}),
    auth: {
      session: { verifySession: async (t) => { const m = /^session:(.+)$/.exec(t ?? ""); return m ? { userId: m[1] } : null; } },
      ownership: sqlOwnership(q),
    },
  });
  const call = (path: string, init: { method?: string; body?: unknown; as?: string | null } = {}) =>
    app.request(path, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", ...(init.as === null ? {} : { authorization: as(init.as ?? TEST_CREATOR) }) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  const hook = (body: unknown) => {
    const raw = JSON.stringify(body);
    const t = Math.floor(Date.now() / 1000);
    return app.request("/stream/webhook", {
      method: "POST",
      body: raw,
      headers: { "webhook-signature": `time=${t},sig1=${createHmac("sha256", SECRET).update(`${t}.${raw}`).digest("hex")}` },
    });
  };
  const ready = (uid: string, w: number, h: number, seconds: number) =>
    hook({ uid, readyToStream: true, status: { state: "ready" }, input: { width: w, height: h }, duration: seconds, playback: { hls: `https://customer-x.cloudflarestream.com/${uid}/manifest/video.m3u8` } });
  return { call, hook, ready, captions };
}

async function upload(call: ReturnType<typeof setup>["call"], title: string, as?: string) {
  const res = await call("/videos", { method: "POST", body: { title, size_bytes: 1000, name: `${title}.mp4` }, ...(as ? { as } : {}) });
  assert.equal(res.status, 201);
  return (await res.json()) as { video: { id: string; status: string; visibility: string }; upload_url: string };
}

test("orientation and format rules", () => {
  assert.equal(orientationOf(1080, 1920), "vertical");
  assert.equal(orientationOf(1920, 1080), "horizontal");
  assert.equal(orientationOf(1080, 1080), "square");
  assert.equal(orientationOf(null, 1080), null);
  assert.equal(formatOf("vertical", 30_000), "short");
  assert.equal(formatOf("square", 170_000), "short");
  assert.equal(formatOf("vertical", 600_000), "long");
  assert.equal(formatOf("horizontal", 30_000), "long");
  const c = encodeCursor({ published_at: "2026-10-01T10:00:00.000Z", id: "aaaaaaaa-0000-0000-0000-000000000001" })!;
  assert.deepEqual(decodeCursor(c), { at: "2026-10-01T10:00:00.000Z", id: "aaaaaaaa-0000-0000-0000-000000000001" });
  assert.equal(decodeCursor("garbage"), null);
});

test("upload needs a signed-in creator, a title, a size, and Stream", async () => {
  const db = await freshDb();
  const { call } = setup(db);
  assert.equal((await call("/videos", { method: "POST", body: { title: "x", size_bytes: 10 }, as: null })).status, 401);
  assert.equal((await call("/videos", { method: "POST", body: { size_bytes: 10 } })).status, 400);
  assert.equal((await call("/videos", { method: "POST", body: { title: "x", size_bytes: 0 } })).status, 400);
  const noStream = setup(await freshDb(), false);
  assert.equal((await noStream.call("/videos", { method: "POST", body: { title: "x", size_bytes: 10 } })).status, 501);
});

test("a vertical upload becomes a captioned short; drafts are private until published", async () => {
  const db = await freshDb();
  const { call, ready, captions } = setup(db);
  const { video, upload_url } = await upload(call, "Morning routine");
  assert.equal(upload_url, "https://upload.example/tus/vid1");
  assert.equal(video.status, "uploading");
  assert.equal(video.visibility, "draft");

  assert.equal((await call(`/videos/${video.id}`, { as: null })).status, 404, "guests cannot see a draft");
  assert.equal((await call(`/videos/${video.id}`, { as: OTHER })).status, 404, "nor can other creators");
  assert.equal((await call(`/videos/${video.id}`)).status, 200, "the owner can");

  assert.equal((await ready("vid1", 1080, 1920, 42)).status, 200);
  const dto = (await (await call(`/videos/${video.id}`)).json()) as { orientation: string; format: string; duration_ms: number; accessibility: { captions: boolean }; thumbnail_url: string };
  assert.equal(dto.orientation, "vertical");
  assert.equal(dto.format, "short");
  assert.equal(dto.duration_ms, 42000);
  assert.deepEqual(captions, [{ uid: "vid1", lang: "en" }], "captions are requested automatically");
  assert.equal(dto.accessibility.captions, true);
  assert.equal(dto.thumbnail_url, "https://customer-x.cloudflarestream.com/vid1/thumbnails/thumbnail.jpg");

  assert.equal(((await (await call("/feed/shorts", { as: null })).json()) as { items: unknown[] }).items.length, 0, "not in the feed while a draft");
  assert.equal((await call(`/videos/${video.id}`, { method: "PATCH", body: { visibility: "published" } })).status, 200);
  const feed = (await (await call("/feed/shorts", { as: null })).json()) as { items: Array<{ id: string }> };
  assert.deepEqual(feed.items.map((i) => i.id), [video.id]);
  const pb = (await (await call(`/videos/${video.id}/playback`, { as: null })).json()) as { playback_url: string };
  assert.equal(pb.playback_url, "https://customer-x.cloudflarestream.com/signed-vid1/manifest/video.m3u8");
});

test("a horizontal upload is long-form: on home, not in shorts", async () => {
  const db = await freshDb();
  const { call, ready } = setup(db);
  const { video } = await upload(call, "Documentary");
  await ready("vid1", 1920, 1080, 600);
  await call(`/videos/${video.id}`, { method: "PATCH", body: { visibility: "published" } });
  const shorts = (await (await call("/feed/shorts", { as: null })).json()) as { items: unknown[] };
  assert.equal(shorts.items.length, 0);
  const home = (await (await call("/feed/home", { as: null })).json()) as { rows: Array<{ id: string; items: Array<{ id: string; orientation: string }> }> };
  const long = home.rows.find((r) => r.id === "long")!;
  assert.equal(long.items[0].id, video.id);
  assert.equal(long.items[0].orientation, "horizontal");
  assert.ok(!home.rows.some((r) => r.id === "shorts"), "empty rows are omitted");
});

test("only the owner can edit or delete; failed transcodes never reach feeds", async () => {
  const db = await freshDb();
  const { call, hook } = setup(db);
  const { video } = await upload(call, "Mine");
  assert.equal((await call(`/videos/${video.id}`, { method: "PATCH", body: { title: "pwned" }, as: OTHER })).status, 403);
  assert.equal((await call(`/videos/${video.id}`, { method: "DELETE", as: OTHER })).status, 403);
  await hook({ uid: "vid1", readyToStream: false, status: { state: "error" } });
  await call(`/videos/${video.id}`, { method: "PATCH", body: { visibility: "published" } });
  const home = (await (await call("/feed/home", { as: null })).json()) as { rows: unknown[] };
  assert.equal(home.rows.length, 0);
  assert.equal((await call(`/videos/${video.id}`, { as: null })).status, 404);
  assert.equal((await call(`/videos/${video.id}`, { method: "DELETE" })).status, 200);
});

test("the shorts feed paginates with a cursor", async () => {
  const db = await freshDb();
  const { call, ready } = setup(db);
  for (let i = 1; i <= 12; i++) {
    const { video } = await upload(call, `Short ${i}`);
    await ready(`vid${i}`, 720, 1280, 20);
    await call(`/videos/${video.id}`, { method: "PATCH", body: { visibility: "published" } });
  }
  const p1 = (await (await call("/feed/shorts", { as: null })).json()) as { items: Array<{ id: string }>; next_cursor: string | null };
  assert.equal(p1.items.length, 10);
  assert.ok(p1.next_cursor);
  const p2 = (await (await call(`/feed/shorts?cursor=${p1.next_cursor}`, { as: null })).json()) as { items: Array<{ id: string }>; next_cursor: string | null };
  assert.equal(p2.items.length, 2);
  assert.equal(p2.next_cursor, null);
  assert.equal(new Set([...p1.items, ...p2.items].map((i) => i.id)).size, 12, "no duplicates across pages");
});

test("the creator's studio list includes drafts; channels show only published videos", async () => {
  const db = await freshDb();
  const { call, ready } = setup(db);
  const a = await upload(call, "Draft one");
  const b = await upload(call, "Live one");
  await ready("vid2", 1920, 1080, 300);
  await call(`/videos/${b.video.id}`, { method: "PATCH", body: { visibility: "published" } });
  const mine = (await (await call("/me/videos")).json()) as { items: Array<{ id: string }> };
  assert.deepEqual(new Set(mine.items.map((i) => i.id)), new Set([a.video.id, b.video.id]));
  const ch = (await (await call(`/channels/${TEST_CREATOR}`, { as: null })).json()) as { items: Array<{ id: string }> };
  assert.deepEqual(ch.items.map((i) => i.id), [b.video.id]);
});
