// Standalone creator videos (platform v2, phase 1): any length, any aspect ratio, free to watch. Media on
// Cloudflare Stream (tus upload straight from the creator's browser, signed HLS playback). Orientation, size,
// duration, and short/long format come from Stream's ready webhook; captions are requested automatically
// (accessible by default). Viewers see only published + ready videos; drafts only their owner.
// One SQL implementation over a pg-shaped query (production node-postgres, tests PGlite). No em dashes.

import type { Hono } from "hono";
import type { Query } from "./ownership.js";
import { MAX_UPLOAD_BYTES, StreamError, type StreamApi } from "./stream.js";

export type Orientation = "vertical" | "horizontal" | "square";
export type VideoFormat = "short" | "long";

export const SHORT_MAX_MS = 3 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The public shape every client (web, studio, mobile) reads.
export interface VideoDto {
  id: string;
  title: string;
  description: string | null;
  channel: { id: string; name: string };
  orientation: Orientation | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  format: VideoFormat | null;
  language: string;
  category: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  visibility: "draft" | "published";
  status: "uploading" | "ready" | "error" | null;
  views: number;
  accessibility: { captions: boolean; audio_description: boolean; sign: boolean; dubs: string[] };
  sponsor: { brand: string; disclosure: string } | null;
}

export function orientationOf(width: number | null | undefined, height: number | null | undefined): Orientation | null {
  if (!width || !height) return null;
  const r = width / height;
  if (r < 0.9) return "vertical";
  if (r > 1.1) return "horizontal";
  return "square";
}

// Short = a vertical (or square) video up to 3 minutes; everything else is long-form.
export function formatOf(orientation: Orientation | null, durationMs: number | null): VideoFormat {
  return orientation !== "horizontal" && durationMs != null && durationMs <= SHORT_MAX_MS ? "short" : "long";
}

const SELECT = `select v.*, coalesce(to_jsonb(u)->>'username', split_part(u.email, '@', 1), 'Creator') as channel_name
  from videos v join users u on u.id = v.owner_id`;

type Row = Record<string, unknown>;
const n = (v: unknown): number | null => (v == null ? null : Number(v));

export function toDto(r: Row, thumbFromHls = true): VideoDto {
  const captions = Array.isArray(r.captions) ? (r.captions as Array<{ lang?: string }>) : [];
  const dubs = r.dub_audio_urls && typeof r.dub_audio_urls === "object" ? Object.keys(r.dub_audio_urls as object) : [];
  const sponsor = r.sponsor && typeof r.sponsor === "object" ? (r.sponsor as { brand?: string; disclosure?: string }) : null;
  // Stream serves a poster frame at /<uid>/thumbnails/thumbnail.jpg on the same customer host as the manifest.
  const hls = typeof r.stream_hls === "string" ? r.stream_hls : null;
  const thumb = (r.thumbnail_url as string | null) ?? (thumbFromHls && hls ? hls.replace(/\/manifest\/video\.m3u8.*$/, "/thumbnails/thumbnail.jpg") : null);
  return {
    id: String(r.id),
    title: String(r.title),
    description: (r.description as string | null) ?? null,
    channel: { id: String(r.owner_id), name: String(r.channel_name ?? "Creator") },
    orientation: (r.orientation as Orientation | null) ?? null,
    width: n(r.width),
    height: n(r.height),
    duration_ms: n(r.duration_ms),
    format: (r.format as VideoFormat | null) ?? null,
    language: String(r.language ?? "en"),
    category: (r.category as string | null) ?? null,
    thumbnail_url: thumb,
    published_at: r.published_at == null ? null : new Date(r.published_at as string).toISOString(),
    visibility: r.visibility === "published" ? "published" : "draft",
    status: (r.stream_status as VideoDto["status"]) ?? null,
    views: Number(r.views ?? 0),
    accessibility: {
      captions: captions.length > 0,
      audio_description: r.audio_description_url != null,
      sign: r.sign_video_url != null,
      dubs,
    },
    sponsor: sponsor?.brand ? { brand: sponsor.brand, disclosure: sponsor.disclosure ?? `Sponsored by ${sponsor.brand}` } : null,
  };
}

export interface VideoStore {
  create(input: { ownerId: string; title: string; description: string | null; language: string; category: string | null; format: VideoFormat | null; streamUid: string }): Promise<Row>;
  get(id: string): Promise<Row | null>;
  update(id: string, patch: Partial<{ title: string; description: string | null; language: string; category: string | null; format: VideoFormat; visibility: "draft" | "published" }>): Promise<Row | null>;
  remove(id: string): Promise<boolean>;
  listOwned(ownerId: string): Promise<Row[]>;
  shorts(limit: number, before: { at: string; id: string } | null): Promise<Row[]>;
  latest(format: VideoFormat | null, limit: number): Promise<Row[]>;
  popular(limit: number): Promise<Row[]>;
  byChannel(ownerId: string, limit: number): Promise<Row[]>;
  markReady(uid: string, hls: string, durationMs: number | null, width: number | null, height: number | null): Promise<Row | null>;
  markError(uid: string): Promise<string | null>;
  setCaptions(id: string, captions: Array<{ lang: string; status: string }>): Promise<void>;
}

const LIVE = "v.visibility = 'published' and v.stream_status = 'ready'";

export function sqlVideoStore(query: Query): VideoStore {
  const rows = async (sql: string, params: unknown[]) => (await query(sql, params)).rows;
  const one = async (sql: string, params: unknown[]) => (await rows(sql, params))[0] ?? null;
  return {
    async create(i) {
      const r = await one(
        `insert into videos (owner_id, title, description, language, category, format, stream_uid, stream_status)
         values ($1, $2, $3, $4, $5, $6, $7, 'uploading') returning id`,
        [i.ownerId, i.title, i.description, i.language, i.category, i.format, i.streamUid],
      );
      return (await this.get(String(r!.id)))!;
    },
    get: (id) => (UUID_RE.test(id) ? one(`${SELECT} where v.id = $1`, [id]) : Promise.resolve(null)),
    async update(id, patch) {
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        params.push(v);
        sets.push(`${k} = $${params.length}`);
      }
      if (patch.visibility === "published") sets.push("published_at = coalesce(published_at, now())");
      if (patch.visibility === "draft") sets.push("published_at = null");
      if (sets.length === 0) return this.get(id);
      await query(`update videos set ${sets.join(", ")} where id = $1`, params);
      return this.get(id);
    },
    async remove(id) {
      if (!UUID_RE.test(id)) return false;
      return (await rows("delete from videos where id = $1 returning id", [id])).length > 0;
    },
    listOwned: (ownerId) => rows(`${SELECT} where v.owner_id = $1 order by v.created_at desc`, [ownerId]),
    shorts: (limit, before) =>
      before
        ? rows(
            `${SELECT} where ${LIVE} and v.format = 'short' and (v.published_at, v.id) < ($1::timestamptz, $2::uuid)
             order by v.published_at desc, v.id desc limit $3`,
            [before.at, before.id, limit],
          )
        : rows(`${SELECT} where ${LIVE} and v.format = 'short' order by v.published_at desc, v.id desc limit $1`, [limit]),
    latest: (format, limit) =>
      format
        ? rows(`${SELECT} where ${LIVE} and v.format = $1 order by v.published_at desc limit $2`, [format, limit])
        : rows(`${SELECT} where ${LIVE} order by v.published_at desc limit $1`, [limit]),
    popular: (limit) => rows(`${SELECT} where ${LIVE} order by v.views desc, v.published_at desc limit $1`, [limit]),
    byChannel: (ownerId, limit) =>
      UUID_RE.test(ownerId)
        ? rows(`${SELECT} where ${LIVE} and v.owner_id = $1 order by v.published_at desc limit $2`, [ownerId, limit])
        : Promise.resolve([]),
    async markReady(uid, hls, durationMs, width, height) {
      const orientation = orientationOf(width, height);
      const r = await one(
        `update videos set stream_status = 'ready', stream_hls = $2, duration_ms = coalesce($3, duration_ms),
            width = coalesce($4, width), height = coalesce($5, height), orientation = coalesce($6, orientation),
            format = coalesce(format, $7)
          where stream_uid = $1 returning id`,
        [uid, hls, durationMs, width, height, orientation, formatOf(orientation, durationMs)],
      );
      return r ? this.get(String(r.id)) : null;
    },
    async markError(uid) {
      const r = await one("update videos set stream_status = 'error' where stream_uid = $1 returning id", [uid]);
      return r ? String(r.id) : null;
    },
    async setCaptions(id, captions) {
      await query("update videos set captions = $2::jsonb where id = $1", [id, JSON.stringify(captions)]);
    },
  };
}

// Opaque feed cursor: base64url of "<published_at>|<id>".
export const encodeCursor = (r: { published_at: string | null; id: string }) =>
  r.published_at ? Buffer.from(`${r.published_at}|${r.id}`).toString("base64url") : null;
export function decodeCursor(c: string | undefined): { at: string; id: string } | null {
  if (!c) return null;
  try {
    const [at, id] = Buffer.from(c, "base64url").toString("utf8").split("|");
    return at && id && UUID_RE.test(id) && !Number.isNaN(Date.parse(at)) ? { at, id } : null;
  } catch {
    return null;
  }
}

type Ctx = { req: { header: (k: string) => string | undefined; param: (k: string) => string; query: (k: string) => string | undefined; json: () => Promise<unknown> }; json: (b: unknown, s?: number) => Response };

export interface VideoRouteDeps {
  videos: VideoStore;
  stream?: StreamApi;
  viewerOf: (c: Ctx) => Promise<string | null>;
  signedIn: (c: Ctx) => Promise<string | Response>;
  // Interactive series for the home "Interactive series" row (the existing published feed).
  publishedSeries?: () => Promise<Array<Record<string, unknown>>>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export function mountVideoRoutes(app: Hono, d: VideoRouteDeps): void {
  const readBody = async (c: Ctx): Promise<Record<string, unknown> | null> => {
    try {
      const b = await c.req.json();
      return isObj(b) ? b : null;
    } catch {
      return null;
    }
  };
  // The video if this viewer may see it: published + ready for everyone, anything for its owner.
  const visible = async (c: Ctx, id: string): Promise<{ row: Row; isOwner: boolean } | null> => {
    const row = await d.videos.get(id);
    if (!row) return null;
    const viewer = await d.viewerOf(c);
    const isOwner = viewer != null && String(row.owner_id) === viewer;
    const live = row.visibility === "published" && row.stream_status === "ready";
    return live || isOwner ? { row, isOwner } : null;
  };
  const owned = async (c: Ctx, id: string): Promise<Row | Response> => {
    const uid = await d.signedIn(c);
    if (uid instanceof Response) return uid;
    const row = await d.videos.get(id);
    if (!row) return c.json({ error: "not_found" }, 404);
    if (String(row.owner_id) !== uid) return c.json({ error: "forbidden" }, 403);
    return row;
  };

  // POST /videos : start an upload. Creates the draft video and a one-time tus URL straight to Stream.
  app.post("/videos", async (c) => {
    const uid = await d.signedIn(c);
    if (uid instanceof Response) return uid;
    if (!d.stream) return c.json({ error: "stream_not_configured" }, 501);
    const b = await readBody(c);
    if (!b) return c.json({ error: "invalid_json" }, 400);
    const title = str(b.title, 200);
    if (!title) return c.json({ error: "invalid_title" }, 400);
    const size = b.size_bytes;
    if (typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
      return c.json({ error: "invalid_size_bytes", max: MAX_UPLOAD_BYTES }, 400);
    }
    const format = b.format === "short" || b.format === "long" ? b.format : null;
    let upload;
    try {
      upload = await d.stream.createDirectUpload({ sizeBytes: size, name: str(b.name, 200) ?? title, creatorId: uid });
    } catch (e) {
      return c.json({ error: "stream_upload_failed", status: e instanceof StreamError ? e.status : 0 }, 502);
    }
    const row = await d.videos.create({
      ownerId: uid,
      title,
      description: str(b.description, 5000),
      language: str(b.language, 16) ?? "en",
      category: str(b.category, 64),
      format,
      streamUid: upload.uid,
    });
    return c.json({ video: toDto(row), upload_url: upload.uploadUrl }, 201);
  });

  // GET /me/videos : the signed-in creator's videos (drafts included) for the studio.
  app.get("/me/videos", async (c) => {
    const uid = await d.signedIn(c);
    if (uid instanceof Response) return uid;
    return c.json({ items: (await d.videos.listOwned(uid)).map((r) => toDto(r)) }, 200);
  });

  app.get("/videos/:id", async (c) => {
    const v = await visible(c, c.req.param("id"));
    return v ? c.json(toDto(v.row), 200) : c.json({ error: "not_found" }, 404);
  });

  // PATCH /videos/:id : edit metadata or publish/unpublish (owner).
  app.patch("/videos/:id", async (c) => {
    const row = await owned(c, c.req.param("id"));
    if (row instanceof Response) return row;
    const b = await readBody(c);
    if (!b) return c.json({ error: "invalid_json" }, 400);
    const patch: Parameters<VideoStore["update"]>[1] = {};
    if (b.title !== undefined) {
      const t = str(b.title, 200);
      if (!t) return c.json({ error: "invalid_title" }, 400);
      patch.title = t;
    }
    if (b.description !== undefined) patch.description = str(b.description, 5000);
    if (b.language !== undefined) patch.language = str(b.language, 16) ?? "en";
    if (b.category !== undefined) patch.category = str(b.category, 64);
    if (b.format === "short" || b.format === "long") patch.format = b.format;
    if (b.visibility === "published" || b.visibility === "draft") patch.visibility = b.visibility;
    const updated = await d.videos.update(String(row.id), patch);
    return c.json(toDto(updated!), 200);
  });

  app.delete("/videos/:id", async (c) => {
    const row = await owned(c, c.req.param("id"));
    if (row instanceof Response) return row;
    await d.videos.remove(String(row.id));
    return c.json({ id: String(row.id), deleted: true }, 200);
  });

  // GET /videos/:id/playback : a short-lived signed HLS URL (captions are embedded in the manifest).
  app.get("/videos/:id/playback", async (c) => {
    const v = await visible(c, c.req.param("id"));
    if (!v) return c.json({ error: "not_found" }, 404);
    const { row } = v;
    if (row.stream_status !== "ready" || !row.stream_hls || !row.stream_uid) return c.json({ error: "not_ready" }, 409);
    if (!d.stream) return c.json({ error: "stream_not_configured" }, 503);
    return c.json({ playback_url: d.stream.signPlaybackUrl(String(row.stream_hls), String(row.stream_uid)) }, 200);
  });

  // GET /feed/shorts?cursor= : the vertical swipe feed, newest first, keyset-paginated.
  app.get("/feed/shorts", async (c) => {
    const limit = 10;
    const items = await d.videos.shorts(limit, decodeCursor(c.req.query("cursor")));
    const dtos = items.map((r) => toDto(r));
    const last = dtos.at(-1);
    return c.json({ items: dtos, next_cursor: dtos.length === limit && last ? encodeCursor(last) : null }, 200);
  });

  // GET /feed/home : Netflix-style rows. Empty rows are omitted.
  app.get("/feed/home", async (c) => {
    const [fresh, popular, shorts, long] = await Promise.all([
      d.videos.latest(null, 20),
      d.videos.popular(20),
      d.videos.latest("short", 20),
      d.videos.latest("long", 20),
    ]);
    const rows = [
      { id: "new", title: "New", items: fresh.map((r) => toDto(r)) },
      { id: "popular", title: "Popular", items: popular.map((r) => toDto(r)) },
      { id: "shorts", title: "Shorts", items: shorts.map((r) => toDto(r)) },
      { id: "long", title: "Watch long-form", items: long.map((r) => toDto(r)) },
    ].filter((r) => r.items.length > 0);
    const series = d.publishedSeries ? await d.publishedSeries() : [];
    return c.json({ rows, series }, 200);
  });

  app.get("/channels/:id", async (c) => {
    const items = (await d.videos.byChannel(c.req.param("id"), 50)).map((r) => toDto(r));
    if (items.length === 0) return c.json({ error: "not_found" }, 404);
    return c.json({ channel: items[0].channel, items }, 200);
  });
}

// Handle a Stream webhook for a standalone video. Returns null when the uid is not a video (a series cut).
export async function handleVideoWebhook(
  videos: VideoStore,
  stream: StreamApi,
  v: { uid: string; state?: string; ready: boolean; hls?: string; durationMs: number | null; width: number | null; height: number | null },
): Promise<{ video_id: string; state: string } | null> {
  if (v.ready && v.state === "ready" && v.hls) {
    const row = await videos.markReady(v.uid, v.hls, v.durationMs, v.width, v.height);
    if (!row) return null;
    // Accessible by default: request AI captions in the video's language (best effort; never blocks ready).
    const lang = String(row.language ?? "en");
    const existing = Array.isArray(row.captions) ? (row.captions as Array<{ lang: string; status: string }>) : [];
    if (!existing.some((c) => c.lang === lang)) {
      let ok = false;
      try {
        ok = await stream.generateCaptions(v.uid, lang);
      } catch {
        ok = false;
      }
      if (ok) await videos.setCaptions(String(row.id), [...existing, { lang, status: "requested" }]);
    }
    return { video_id: String(row.id), state: "ready" };
  }
  if (v.state === "error") {
    const id = await videos.markError(v.uid);
    return id ? { video_id: id, state: "error" } : null;
  }
  return null;
}
