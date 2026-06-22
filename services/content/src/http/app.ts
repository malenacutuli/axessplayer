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

  // GET /series/{id}/graph : resolve a series into its playable graph, or 404. The id is validated by the
  // handler (a malformed uuid is a clean 404 without touching the DB), so the route only forwards it.
  app.get("/series/:id/graph", async (c) => {
    const id: GraphIdParam = c.req.param("id");
    const result = await handleGetSeriesGraph(id, db);
    return c.json(result.body, result.status as 200 | 404);
  });

  // POST /series : create a series. A malformed or missing JSON body becomes a 400 here rather than an
  // unhandled 500; the handler applies the server-authoritative defaults and validation.
  app.post("/series", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const result = await handleCreateSeries(raw as CreateSeriesBody, db);
    return c.json(result.body, result.status as 201 | 400);
  });

  // POST /episodes : create an episode under a series. is_free and coin_cost default server-side.
  app.post("/episodes", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const result = await handleCreateEpisode(raw as CreateEpisodeBody, db);
    return c.json(result.body, result.status as 201 | 400);
  });

  // POST /beats : create a beat under an episode. The handler pre-checks the composite-FK rule (the beat's
  // series must equal its episode's series) for a clean 400.
  app.post("/beats", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const result = await handleCreateBeat(raw as CreateBeatBody, db);
    return c.json(result.body, result.status as 201 | 400);
  });

  // POST /variants : attach a variant to a beat. is_premium and coin_cost default to free/non-premium.
  app.post("/variants", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const result = await handleCreateVariant(raw as CreateVariantBody, db);
    return c.json(result.body, result.status as 201 | 400);
  });

  // DELETE /variants/{id} : remove a beat_variant (an uploaded or registered cut). The media bytes on the
  // ingest server are pruned separately by the Studio; the content DB owns only the row.
  app.delete("/variants/:id", async (c) => {
    const result = await handleDeleteVariant(c.req.param("id"), db);
    return c.json(result.body, result.status as 200 | 400 | 404);
  });

  // PATCH /variants/{id}/tracks (0009a) : attach real accessibility track URLs from the Axessible pipeline.
  app.patch("/variants/:id/tracks", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const result = await handleSetVariantTracks(c.req.param("id"), raw, db);
    return c.json(result.body, result.status as 200 | 400 | 404);
  });

  // POST /series/{id}/publish and /unpublish (0009b) : flip the series publish state.
  app.post("/series/:id/publish", async (c) => {
    const result = await handleSetSeriesPublished(c.req.param("id"), true, db);
    return c.json(result.body, result.status as 200 | 400 | 404);
  });
  app.post("/series/:id/unpublish", async (c) => {
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
    return c.json(result.body, result.status as 200);
  });

  // PATCH /series/{id} : rename / update series metadata (title, genre, languages, cover). Only the fields
  // present in the body change.
  app.patch("/series/:id", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const result = await handleUpdateSeries(c.req.param("id"), raw, db);
    return c.json(result.body, result.status as 200 | 400 | 404);
  });

  // GET /admin/overview : read-only operator dashboard aggregates (content + ledger + decisions).
  app.get("/admin/overview", async (c) => {
    const result = await handleAdminOverview(db);
    return c.json(result.body, result.status as 200 | 501);
  });

  // POST /admin/paywall-event : append a paywall presentation (bandit propensity) to the events stream.
  app.post("/admin/paywall-event", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const result = await handleAdminPaywallEvent(raw, db);
    return c.json(result.body, result.status as 200 | 400 | 501);
  });

  // GET /admin/ads-today/{userId}?day=YYYY-MM-DD : today's rewarded_ad count (server-side cap input).
  app.get("/admin/ads-today/:userId", async (c) => {
    const day = c.req.query("day") ?? new Date().toISOString().slice(0, 10);
    const result = await handleAdminAdsToday(c.req.param("userId"), day, db);
    return c.json(result.body, result.status as 200 | 400 | 501);
  });

  // POST /series/{id}/poster/generate : server-side generate (stability-ai) -> upload -> persist
  // series.poster_url with C2PA + Article 50 provenance. The generation key never reaches the browser.
  app.post("/series/:id/poster/generate", async (c) => {
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
    const result = await handleSetSeriesPoster(c.req.param("id"), raw, db);
    return c.json(result.body, result.status as 200 | 400 | 404);
  });

  // POST /series/{id}/produce : Simple-mode auto-produce. Returns the stage plan + cost + job id.
  app.post("/series/:id/produce", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const result = await handleProduceSeries(c.req.param("id"), raw, db);
    return c.json(result.body, result.status as 200 | 400 | 404 | 409);
  });

  // POST /edges : connect two beats with an optional condition. The handler rejects self-edges and
  // cross-series edges so the graph stays inside one series boundary.
  app.post("/edges", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
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
  // The reader identity for reading_state comes from the session bearer (session:<uuid>), never the body.
  const sessionUser = (c: { req: { header: (k: string) => string | undefined } }): string | null => {
    const m = /^Bearer\s+session:([0-9a-fA-F-]{36})$/.exec(c.req.header("authorization") ?? "");
    return m ? m[1] : null;
  };

  if (reading) {
    app.post("/works", async (c) => {
      const raw = await readJson(c);
      if (!isRecord(raw)) return c.json({ error: "invalid_json" }, 400);
      return runReading(c, () => createWork(raw as unknown as CreateWorkInput, reading), 201);
    });
    app.post("/works/:id/chapters", async (c) => {
      const raw = await readJson(c);
      if (!isRecord(raw)) return c.json({ error: "invalid_json" }, 400);
      return runReading(c, () => addChapter(c.req.param("id"), raw as unknown as CreateChapterInput, reading), 201);
    });
    app.post("/works/:id/publish", (c) =>
      runReading(c, async () => {
        await reading.publishWork(c.req.param("id"));
        return { ok: true };
      }),
    );
    app.get("/works/:id", async (c) => {
      const detail = await reading.getWorkDetail(c.req.param("id"));
      return detail ? c.json(detail, 200) : c.json({ error: "work_not_found" }, 404);
    });
    // run the demand sensor for a work and persist the verdict (the Studio demand dashboard reads this).
    app.post("/works/:id/recompute-demand", (c) => runReading(c, () => recomputeDemand(c.req.param("id"), reading)));
    // one-click "adapt to series": graduate a ready_to_adapt work into a video series + beats.
    app.post("/works/:id/adapt", async (c) => {
      const raw = (await readJson(c)) as { force?: boolean } | null;
      return runReading(c, () => adaptWork(c.req.param("id"), reading, { force: raw?.force === true }));
    });
    // the ready_to_adapt demand dashboard list.
    app.get("/reading/candidates", (c) => runReading(c, () => reading.listCandidates(c.req.query("status") || undefined)));
    // per-reader progress, the reading_state sibling of viewer_state. Identity from the session bearer.
    app.put("/works/:id/reading-state", async (c) => {
      const uid = sessionUser(c);
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
