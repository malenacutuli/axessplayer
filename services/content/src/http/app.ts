// HTTP adapter for the content service. A thin Hono app over the framework-agnostic handlers in
// content.ts. It does exactly three things the handlers cannot do for themselves, all at the edge:
//
//   1. Route the contract paths (content.yaml 0.3.1): GET /series/{id}/graph plus the create* POSTs.
//   2. Parse JSON bodies into the handler input shapes, and pull the {id} path param off the request.
//   3. Map each handler's { status, body } to an HTTP response verbatim.
//
// All business logic (validation, enum guards, composite-FK pre-checks, server-authoritative defaults
// for coin_cost/is_free/is_premium) lives below this layer in the handlers. This file adds none of it
// and does NOT modify the handlers. The contract documents no auth for content authoring, so unlike the
// economy adapter there is no trust-boundary layer here; if auth is later added to content.yaml this is
// where it would mount. No em dashes.

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { operations } from "@axessplayer/contracts/content";
import {
  handleGetSeriesGraph,
  handleCreateSeries,
  handleCreateEpisode,
  handleCreateBeat,
  handleCreateVariant,
  handleDeleteVariant,
  handleSetVariantTracks,
  handleSetSeriesPublished,
  handleUpdateSeries,
  handleListAllSeries,
  handleGetFeed,
  handleAdminOverview,
  handleAdminAdsToday,
  handleAdminPaywallEvent,
  handleSetSeriesPoster,
  handleProduceSeries,
  handleCreateEdge,
  type ContentDB,
  type CreateSeriesBody,
  type CreateEpisodeBody,
  type CreateBeatBody,
  type CreateVariantBody,
  type CreateEdgeBody,
} from "../content.js";
import type { PosterGenerator } from "../poster.js";
import type { SessionVerifier } from "@axessplayer/session-auth";
import type { Ownership, SeriesAccess } from "../ownership.js";
import type { MediaStore } from "../mediaStore.js";
import { isStreamRef, streamRef, MAX_UPLOAD_BYTES, StreamError, type StreamApi, type StreamWebhookVideo } from "../stream.js";
import type { SeriesGraph } from "../content.js";
import { readerPageHtml, readFeedHtml } from "../readerPage.js";
import { watchFeedHtml, watchPlayerHtml } from "../watchPage.js";
import {
  createWork,
  addChapter,
  upsertReadingState,
  recomputeDemand,
  adaptWork,
  ReadingError,
  type ReadingStore,
  type CreateWorkInput,
  type CreateChapterInput,
} from "../reading-service.js";

// Path param pinned to the contract (content.yaml 0.3.1) via the generated operations type, so the route
// cannot drift from the spec without a type error. The contract documents no request body schemas for the
// create* routes (requestBody is `never` in the generated types), so the input shapes are taken from the
// handlers' own exported body types, which are the source of truth for the column-derived payloads.
type GraphIdParam = operations["getSeriesGraph"]["parameters"]["path"]["id"];

export interface AppDeps {
  db: ContentDB;
  // Optional server-side poster generator (stability-ai -> storage). When absent the generate route
  // answers 501, so the test harness and any deploy without image keys stays clean.
  posterGen?: PosterGenerator;
  // Optional reading platform store (prompt 28). When wired, the /works, /reading, and adapt routes mount;
  // when absent they are simply not registered. Production wires PgReadingDb; tests wire a fake.
  reading?: ReadingStore;
  // Public base URL of the events service (EVENTS_BASE_URL). Injected into the reader/watch pages so reading
  // and viewing behavior flow into the engagement pipeline (the demand sensor). Empty disables emission.
  eventsBaseUrl?: string;
  // Creator auth. Every write needs a verified session, and series writes need the series owner. Without it
  // the write routes answer 503 (fail closed). serviceSecret guards the service-to-service /admin routes.
  auth?: { session: SessionVerifier; ownership: Ownership; serviceSecret?: string };
  // Media state + entitlements (Stream lifecycle, premium gating). Production wires sqlMediaStore.
  media?: MediaStore;
  // Cloudflare Stream API (uploads, webhook verification, signed playback). Absent: upload routes answer 501.
  stream?: StreamApi;
  // Creator-scoped dashboard numbers (same shape as the operator overview, own series only).
  creatorOverview?: (ownerId: string) => Promise<unknown>;
}

type Ctx = { req: { header: (k: string) => string | undefined }; json: (b: unknown, s?: number) => Response };

function bearerOf(c: Ctx): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "");
  return m ? m[1].trim() : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Build the content HTTP app. The DB is injected so production wires the node-postgres PgContentDb while
// tests wire a PGlite-backed ContentDB. The adapter never reaches the database directly; every route
// delegates to a handler that owns the ContentDB port.
export function createContentApp(deps: AppDeps): Hono {
  const app = new Hono();
  // Permissive CORS so the consumer app and Studio (different localhost ports in dev) can call this service
  // from the browser. Identity rides the bearer token, not cookies, so origin "*" is safe (no credentials).
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type", "authorization", "accept"],
    }),
  );
  const { db } = deps;
  const auth = deps.auth;

  // The verified viewer (users.id), or null when there is no valid session.
  const viewerOf = async (c: Ctx): Promise<string | null> => {
    const token = bearerOf(c);
    if (!token || !auth) return null;
    return (await auth.session.verifySession(token))?.userId ?? null;
  };
  // A signed-in user id, or the response to send instead (503 unconfigured, 401 signed out).
  const signedIn = async (c: Ctx): Promise<string | Response> => {
    if (!auth) return c.json({ error: "auth_not_configured" }, 503);
    return (await viewerOf(c)) ?? c.json({ error: "sign_in_required" }, 401);
  };
  // The owner's user id, or the response to send instead (403 when the series belongs to someone else).
  const ownerOf = async (c: Ctx, resolve: (o: Ownership) => Promise<SeriesAccess | null>): Promise<string | Response> => {
    const uid = await signedIn(c);
    if (uid instanceof Response || !auth) return uid;
    const a = await resolve(auth.ownership);
    // Unknown or malformed target: nothing exists to change, so the route's own validation answers (its
    // documented 400/404). A signed-in session is still required to get this far.
    if (!a) return uid;
    if (a.ownerId !== uid) return c.json({ error: "forbidden" }, 403);
    return uid;
  };
  // Service-to-service routes: the bearer must equal the configured secret (open only when none is configured,
  // which production refuses to start without).
  const serviceOnly = (c: Ctx): Response | null => {
    if (!auth?.serviceSecret) return null;
    return bearerOf(c) === auth.serviceSecret ? null : c.json({ error: "forbidden" }, 403);
  };
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

  // GET / and GET /healthz : liveness. The bare service URL should answer 200 (not a confusing 404), and
  // surface which capability groups are mounted so a browser hit is self-describing.
  const health = () => ({ ok: true, service: "content", reading: deps.reading != null, posterGen: deps.posterGen != null });
  app.get("/healthz", (c) => c.json(health(), 200));
  app.get("/", (c) =>
    c.json(
      {
        ...health(),
        routes: ["/watch (video feed)", "/watch/:id (player)", "/series/:id/graph", "/feed", "/series", "/episodes", "/beats", "/variants", ...(deps.reading ? ["/read (book feed)", "/read/:id (reader)", "/works", "/works/:id", "/works/:id/adapt", "/reading/candidates"] : [])],
      },
      200,
    ),
  );

  // GET /watch : the video discovery feed (BookTok-style grid). GET /watch/:id : the vertical player that
  // walks the series graph with the accessibility signature (CWI captions, AD, sign, cut selection). Both are
  // data-driven from /feed and /series/:id/graph (always available), so they mount unconditionally.
  app.get("/watch", (c) => c.html(watchFeedHtml()));
  app.get("/watch/:id", (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "invalid_id" }, 400);
    return c.html(watchPlayerHtml(id));
  });

  // GET /series/{id}/graph : resolve a series into its playable graph, or 404. The id is validated by the
  // handler (a malformed uuid is a clean 404 without touching the DB), so the route only forwards it.
  // Make a graph safe to hand to this viewer: premium cuts carry no playable URL (the player asks
  // GET /variants/:id/playback after an unlock) unless the viewer owns the series, and Stream cuts get a
  // short-lived signed URL (or none until the transcode is ready).
  const prepareGraph = async (graph: SeriesGraph, viewerIsOwner: boolean): Promise<void> => {
    const refs = deps.media ? await deps.media.streamRefsOfSeries(graph.series.id) : new Map();
    for (const ep of graph.episodes) {
      for (const beat of ep.beats) {
        for (const v of beat.variants) {
          if (v.is_premium && !viewerIsOwner && auth) {
            v.playback_url = "";
            continue;
          }
          if (isStreamRef(v.playback_url)) {
            const ref = refs.get(v.id);
            v.playback_url =
              ref && ref.status === "ready" && ref.hls && deps.stream ? deps.stream.signPlaybackUrl(ref.hls, ref.uid) : "";
          }
        }
      }
    }
  };

  app.get("/series/:id/graph", async (c) => {
    const id: GraphIdParam = c.req.param("id");
    let viewerIsOwner = false;
    if (auth) {
      // Drafts are private to their owner; published series are public.
      const a = await auth.ownership.ofSeries(id);
      const viewer = await viewerOf(c);
      viewerIsOwner = a != null && a.ownerId != null && a.ownerId === viewer;
      if (a && !a.published && !viewerIsOwner) return c.json({ error: "not_found" }, 404);
    }
    const result = await handleGetSeriesGraph(id, db);
    if (result.status === 200) await prepareGraph(result.body as SeriesGraph, viewerIsOwner);
    return c.json(result.body, result.status as 200 | 404);
  });

  // POST /beats/{id}/stream-upload : start a creator upload to Cloudflare Stream. Creates the pending variant
  // (playback_url stream:<uid>) and returns the one-time tus URL the browser uploads to directly. The Stream
  // webhook marks it ready (qa passed) once transcoded. Owner only.
  app.post("/beats/:id/stream-upload", async (c) => {
    const beatId = c.req.param("id");
    const uid = await ownerOf(c, (o) => o.ofBeat(beatId));
    if (uid instanceof Response) return uid;
    if (!deps.stream || !deps.media) return c.json({ error: "stream_not_configured" }, 501);
    const raw = await readJson(c);
    if (!isRecord(raw)) return c.json({ error: "invalid_json" }, 400);
    const size = raw.size_bytes;
    if (typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
      return c.json({ error: "invalid_size_bytes", max: MAX_UPLOAD_BYTES }, 400);
    }
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "upload";
    let upload;
    try {
      upload = await deps.stream.createDirectUpload({ sizeBytes: size, name, creatorId: uid });
    } catch (e) {
      const status = e instanceof StreamError ? e.status : 0;
      return c.json({ error: "stream_upload_failed", status }, 502);
    }
    const { size_bytes: _s, name: _n, playback_url: _p, qa_status: _q, ...fields } = raw;
    const created = await handleCreateVariant(
      // A creator upload is a filmed cut unless the studio says otherwise (same default as the upload panel).
      { tier: "A_filmed", ...fields, beat_id: beatId, playback_url: streamRef(upload.uid), qa_status: "pending" } as CreateVariantBody,
      db,
    );
    if (created.status !== 201) return c.json(created.body, created.status as 400);
    const variant = created.body as { id: string };
    await deps.media.setStreamUploading(variant.id, upload.uid);
    return c.json({ variant: created.body, upload_url: upload.uploadUrl, stream_uid: upload.uid }, 201);
  });

  // POST /stream/webhook : Cloudflare Stream calls this when a video is ready or failed. Verified with the
  // webhook secret (Webhook-Signature); unsigned or stale deliveries are refused.
  app.post("/stream/webhook", async (c) => {
    if (!deps.stream || !deps.media) return c.json({ error: "stream_not_configured" }, 503);
    const rawBody = await c.req.text();
    if (!deps.stream.verifyWebhook(rawBody, c.req.header("webhook-signature"))) {
      return c.json({ error: "invalid_signature" }, 400);
    }
    let video: StreamWebhookVideo;
    try {
      video = JSON.parse(rawBody) as StreamWebhookVideo;
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    if (!video.uid) return c.json({ error: "missing_uid" }, 400);
    const state = video.status?.state;
    if (video.readyToStream && state === "ready" && video.playback?.hls) {
      const durationMs = typeof video.duration === "number" && video.duration > 0 ? Math.round(video.duration * 1000) : null;
      const variantId = await deps.media.markStreamReady(video.uid, video.playback.hls, durationMs);
      return c.json({ ok: true, variant_id: variantId, state: "ready" }, 200);
    }
    if (state === "error") {
      const variantId = await deps.media.markStreamError(video.uid);
      return c.json({ ok: true, variant_id: variantId, state: "error" }, 200);
    }
    return c.json({ ok: true, ignored: state ?? "unknown" }, 200);
  });

  // GET /variants/{id}/playback : the playable URL for one cut. Free cuts of published series are open to
  // anyone (guests included); drafts only to the owner; premium cuts only to the owner or a viewer holding the
  // beat_variant entitlement (402 otherwise). Stream cuts return a signed URL that expires.
  app.get("/variants/:id/playback", async (c) => {
    if (!deps.media) return c.json({ error: "not_configured" }, 503);
    const info = await deps.media.playbackOf(c.req.param("id"));
    if (!info) return c.json({ error: "not_found" }, 404);
    const viewer = await viewerOf(c);
    const isOwner = viewer != null && info.ownerId === viewer;
    if (!info.seriesPublished && !isOwner) return c.json({ error: "not_found" }, 404);
    if (info.isPremium && !isOwner) {
      if (!viewer) return c.json({ error: "sign_in_required" }, 401);
      if (!(await deps.media.hasEntitlement(viewer, info.variantId))) return c.json({ error: "locked" }, 402);
    }
    if (info.streamUid) {
      if (info.streamStatus !== "ready" || !info.streamHls || !deps.stream) return c.json({ error: "not_ready" }, 409);
      return c.json({ playback_url: deps.stream.signPlaybackUrl(info.streamHls, info.streamUid) }, 200);
    }
    return c.json({ playback_url: info.playbackUrl }, 200);
  });

  // POST /series : create a series. A malformed or missing JSON body becomes a 400 here rather than an
  // unhandled 500; the handler applies the server-authoritative defaults and validation.
  app.post("/series", async (c) => {
    const uid = await signedIn(c);
    if (uid instanceof Response) return uid;
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const result = await handleCreateSeries(raw as CreateSeriesBody, db);
    if (result.status === 201 && auth) await auth.ownership.setOwner((result.body as { id: string }).id, uid);
    return c.json(result.body, result.status as 201 | 400);
  });

  // POST /episodes : create an episode under a series. is_free and coin_cost default server-side.
  app.post("/episodes", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    {
      const sid = str((raw as { series_id?: unknown }).series_id);
      const ok = sid ? await ownerOf(c, (o) => o.ofSeries(sid)) : await signedIn(c);
      if (ok instanceof Response) return ok;
    }
    const result = await handleCreateEpisode(raw as CreateEpisodeBody, db);
    return c.json(result.body, result.status as 201 | 400);
  });

  // POST /beats : create a beat under an episode. The handler pre-checks the composite-FK rule (the beat's
  // series must equal its episode's series) for a clean 400.
  app.post("/beats", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    {
      const eid = str((raw as { episode_id?: unknown }).episode_id);
      const sid = str((raw as { series_id?: unknown }).series_id);
      const ok = eid ? await ownerOf(c, (o) => o.ofEpisode(eid)) : sid ? await ownerOf(c, (o) => o.ofSeries(sid)) : await signedIn(c);
      if (ok instanceof Response) return ok;
      if (eid && sid) {
        const bySeries = await ownerOf(c, (o) => o.ofSeries(sid));
        if (bySeries instanceof Response) return bySeries;
      }
    }
    const result = await handleCreateBeat(raw as CreateBeatBody, db);
    return c.json(result.body, result.status as 201 | 400);
  });

  // POST /variants : attach a variant to a beat. is_premium and coin_cost default to free/non-premium.
  app.post("/variants", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    {
      const bid = str((raw as { beat_id?: unknown }).beat_id);
      const ok = bid ? await ownerOf(c, (o) => o.ofBeat(bid)) : await signedIn(c);
      if (ok instanceof Response) return ok;
    }
    const result = await handleCreateVariant(raw as CreateVariantBody, db);
    return c.json(result.body, result.status as 201 | 400);
  });

  // DELETE /variants/{id} : remove a beat_variant (an uploaded or registered cut). The media bytes on the
  // ingest server are pruned separately by the Studio; the content DB owns only the row.
  app.delete("/variants/:id", async (c) => {
    const ok = await ownerOf(c, (o) => o.ofVariant(c.req.param("id")));
    if (ok instanceof Response) return ok;
    const result = await handleDeleteVariant(c.req.param("id"), db);
    return c.json(result.body, result.status as 200 | 400 | 404);
  });

  // PATCH /variants/{id}/tracks (0009a) : attach real accessibility track URLs from the Axessible pipeline.
  app.patch("/variants/:id/tracks", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    {
      const ok = await ownerOf(c, (o) => o.ofVariant(c.req.param("id")));
      if (ok instanceof Response) return ok;
    }
    const result = await handleSetVariantTracks(c.req.param("id"), raw, db);
    return c.json(result.body, result.status as 200 | 400 | 404);
  });

  // POST /series/{id}/publish and /unpublish (0009b) : flip the series publish state.
  app.post("/series/:id/publish", async (c) => {
    const ok = await ownerOf(c, (o) => o.ofSeries(c.req.param("id")));
    if (ok instanceof Response) return ok;
    const result = await handleSetSeriesPublished(c.req.param("id"), true, db);
    return c.json(result.body, result.status as 200 | 400 | 404);
  });
  app.post("/series/:id/unpublish", async (c) => {
    const ok = await ownerOf(c, (o) => o.ofSeries(c.req.param("id")));
    if (ok instanceof Response) return ok;
    const result = await handleSetSeriesPublished(c.req.param("id"), false, db);
    return c.json(result.body, result.status as 200 | 400 | 404);
  });

  // GET /feed (0009b) : published series only, newest first.
  app.get("/feed", async (c) => {
    const result = await handleGetFeed(db);
    return c.json(result.body, result.status as 200);
  });

  // GET /series : ALL series incl drafts, newest first. The studio picker uses this (not /feed) so the
  // creator can pick and keep building unpublished series.
  app.get("/series", async (c) => {
    const result = await handleListAllSeries(db);
    if (auth) {
      // Drafts are private: the studio picker lists the signed-in creator's own series only.
      const uid = await signedIn(c);
      if (uid instanceof Response) return uid;
      const mine = await auth.ownership.ownedSeriesIds(uid);
      return c.json({ ...result.body, series: result.body.series.filter((row) => mine.has(row.id)) }, 200);
    }
    return c.json(result.body, result.status as 200);
  });

  // PATCH /series/{id} : rename / update series metadata (title, genre, languages, cover). Only the fields
  // present in the body change.
  app.patch("/series/:id", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    {
      const ok = await ownerOf(c, (o) => o.ofSeries(c.req.param("id")));
      if (ok instanceof Response) return ok;
    }
    const result = await handleUpdateSeries(c.req.param("id"), raw, db);
    return c.json(result.body, result.status as 200 | 400 | 404);
  });

  // GET /creator/overview : the signed-in creator's own dashboard numbers (their series only).
  app.get("/creator/overview", async (c) => {
    const uid = await signedIn(c);
    if (uid instanceof Response) return uid;
    if (!deps.creatorOverview) return c.json({ error: "creator_overview_unavailable" }, 501);
    return c.json((await deps.creatorOverview(uid)) as object, 200);
  });

  // GET /admin/overview : read-only operator dashboard aggregates (content + ledger + decisions).
  app.get("/admin/overview", async (c) => {
    const denied = serviceOnly(c);
    if (denied) return denied;
    const result = await handleAdminOverview(db);
    return c.json(result.body, result.status as 200 | 501);
  });

  // POST /admin/paywall-event : append a paywall presentation (bandit propensity) to the events stream.
  app.post("/admin/paywall-event", async (c) => {
    const denied = serviceOnly(c);
    if (denied) return denied;
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const result = await handleAdminPaywallEvent(raw, db);
    return c.json(result.body, result.status as 200 | 400 | 501);
  });

  // GET /admin/ads-today/{userId}?day=YYYY-MM-DD : today's rewarded_ad count (server-side cap input).
  app.get("/admin/ads-today/:userId", async (c) => {
    const denied = serviceOnly(c);
    if (denied) return denied;
    const day = c.req.query("day") ?? new Date().toISOString().slice(0, 10);
    const result = await handleAdminAdsToday(c.req.param("userId"), day, db);
    return c.json(result.body, result.status as 200 | 400 | 501);
  });

  // POST /series/{id}/poster/generate : server-side generate (stability-ai) -> upload -> persist
  // series.poster_url with C2PA + Article 50 provenance. The generation key never reaches the browser.
  app.post("/series/:id/poster/generate", async (c) => {
    const ok = await ownerOf(c, (o) => o.ofSeries(c.req.param("id")));
    if (ok instanceof Response) return ok;
    if (!deps.posterGen) return c.json({ error: "poster_generation_unavailable" }, 501);
    const id = c.req.param("id");
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const prompt = (raw as { prompt?: unknown }).prompt;
    if (typeof prompt !== "string" || prompt.trim().length === 0) return c.json({ error: "invalid_prompt" }, 400);
    let url: string;
    try {
      url = (await deps.posterGen.generate({ seriesId: id, prompt })).url;
    } catch (e) {
      return c.json({ error: "generation_failed", detail: String(e instanceof Error ? e.message : e).slice(0, 160) }, 502);
    }
    const provenance = { c2pa: true, synthetic: true, generator: "stability-ai", article50: "AI-generated" };
    const result = await handleSetSeriesPoster(id, { poster_url: url, provenance }, db);
    return c.json(result.body, result.status as 200 | 400 | 404);
  });

  // PATCH /series/{id}/poster (0009c) : store the chosen generated poster URL + C2PA provenance.
  app.patch("/series/:id/poster", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    {
      const ok = await ownerOf(c, (o) => o.ofSeries(c.req.param("id")));
      if (ok instanceof Response) return ok;
    }
    const result = await handleSetSeriesPoster(c.req.param("id"), raw, db);
    return c.json(result.body, result.status as 200 | 400 | 404);
  });

  // POST /series/{id}/produce : Simple-mode auto-produce. Returns the stage plan + cost + job id.
  app.post("/series/:id/produce", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    {
      const ok = await ownerOf(c, (o) => o.ofSeries(c.req.param("id")));
      if (ok instanceof Response) return ok;
    }
    const result = await handleProduceSeries(c.req.param("id"), raw, db);
    return c.json(result.body, result.status as 200 | 400 | 404 | 409);
  });

  // POST /edges : connect two beats with an optional condition. The handler rejects self-edges and
  // cross-series edges so the graph stays inside one series boundary.
  app.post("/edges", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    {
      const from = str((raw as { from_beat_id?: unknown }).from_beat_id);
      const to = str((raw as { to_beat_id?: unknown }).to_beat_id);
      for (const bid of [from, to]) {
        const ok = bid ? await ownerOf(c, (o) => o.ofBeat(bid)) : await signedIn(c);
        if (ok instanceof Response) return ok;
      }
    }
    const result = await handleCreateEdge(raw as CreateEdgeBody, db);
    return c.json(result.body, result.status as 201 | 400);
  });

  // ================= reading platform (prompt 28): demand sensor + IP origination =================
  // Mounted only when a ReadingStore is wired (production PgReadingDb / the test fake); else not registered.
  const reading = deps.reading;
  const readingStatus = (code: string): 400 | 404 | 409 | 422 =>
    code === "work_not_found" ? 404 : code === "not_ready" ? 409 : code === "no_chapters" ? 422 : 400;
  const runReading = async (
    c: { json: (b: unknown, s?: number) => Response },
    fn: () => Promise<unknown>,
    okStatus = 200,
  ): Promise<Response> => {
    try {
      return c.json((await fn()) as object, okStatus);
    } catch (e) {
      if (e instanceof ReadingError) return c.json({ error: e.code, message: e.message }, readingStatus(e.code));
      return c.json({ error: "reading_error", message: e instanceof Error ? e.message : String(e) }, 500);
    }
  };
  // Reading writes need a verified session (works have no owner column yet: any signed-in user, tracked as a
  // follow-up). The reader identity for reading_state is the verified session subject, never the body.

  if (reading) {
    app.post("/works", async (c) => {
      const uid = await signedIn(c);
      if (uid instanceof Response) return uid;
      const raw = await readJson(c);
      if (!isRecord(raw)) return c.json({ error: "invalid_json" }, 400);
      return runReading(c, () => createWork(raw as unknown as CreateWorkInput, reading), 201);
    });
    app.post("/works/:id/chapters", async (c) => {
      const uid = await signedIn(c);
      if (uid instanceof Response) return uid;
      const raw = await readJson(c);
      if (!isRecord(raw)) return c.json({ error: "invalid_json" }, 400);
      return runReading(c, () => addChapter(c.req.param("id"), raw as unknown as CreateChapterInput, reading), 201);
    });
    app.post("/works/:id/publish", async (c) => {
      const uid = await signedIn(c);
      if (uid instanceof Response) return uid;
      return runReading(c, async () => {
        await reading.publishWork(c.req.param("id"));
        return { ok: true };
      });
    });
    app.get("/works/:id", async (c) => {
      const detail = await reading.getWorkDetail(c.req.param("id"));
      return detail ? c.json(detail, 200) : c.json({ error: "work_not_found" }, 404);
    });
    // GET /read : the reading discovery feed (grid of published works). GET /reading/works : its JSON.
    app.get("/read", (c) => c.html(readFeedHtml()));
    app.get("/reading/works", (c) => runReading(c, () => reading.listPublishedWorks()));
    // GET /read/:id : the accessibility-first reader page (HTML). Clickable chapters, dyslexia font, size
    // controls, screen-reader landmarks; emits reading events to the demand sensor.
    app.get("/read/:id", (c) => {
      const id = c.req.param("id");
      if (!id) return c.json({ error: "invalid_id" }, 400);
      return c.html(readerPageHtml(id, deps.eventsBaseUrl ?? ""));
    });
    // run the demand sensor for a work and persist the verdict (the Studio demand dashboard reads this).
    app.post("/works/:id/recompute-demand", async (c) => {
      const uid = await signedIn(c);
      if (uid instanceof Response) return uid;
      return runReading(c, () => recomputeDemand(c.req.param("id"), reading));
    });
    // one-click "adapt to series": graduate a ready_to_adapt work into a video series + beats.
    app.post("/works/:id/adapt", async (c) => {
      const uid = await signedIn(c);
      if (uid instanceof Response) return uid;
      const raw = (await readJson(c)) as { force?: boolean } | null;
      return runReading(c, () => adaptWork(c.req.param("id"), reading, { force: raw?.force === true }));
    });
    // the ready_to_adapt demand dashboard list.
    app.get("/reading/candidates", (c) => runReading(c, () => reading.listCandidates(c.req.query("status") || undefined)));
    // per-reader progress, the reading_state sibling of viewer_state. Identity from the session bearer.
    app.put("/works/:id/reading-state", async (c) => {
      const uid = await viewerOf(c);
      if (!uid) return c.json({ error: "unauthorized" }, 401);
      const raw = await readJson(c);
      if (!isRecord(raw)) return c.json({ error: "invalid_json" }, 400);
      return runReading(c, async () => {
        await upsertReadingState(uid, c.req.param("id"), Number(raw.chapterIndex), Number(raw.percent), reading);
        return { ok: true };
      });
    });
  }

  return app;
}

// Parse a JSON body, returning null on absent or malformed input so each route can answer 400 itself
// rather than letting a parse throw become an unhandled 500.
async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}
