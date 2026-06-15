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
import type { operations } from "@axessplayer/contracts/content";
import {
  handleGetSeriesGraph,
  handleCreateSeries,
  handleCreateEpisode,
  handleCreateBeat,
  handleCreateVariant,
  handleCreateEdge,
  type ContentDB,
  type CreateSeriesBody,
  type CreateEpisodeBody,
  type CreateBeatBody,
  type CreateVariantBody,
  type CreateEdgeBody,
} from "../content.js";

// Path param pinned to the contract (content.yaml 0.3.1) via the generated operations type, so the route
// cannot drift from the spec without a type error. The contract documents no request body schemas for the
// create* routes (requestBody is `never` in the generated types), so the input shapes are taken from the
// handlers' own exported body types, which are the source of truth for the column-derived payloads.
type GraphIdParam = operations["getSeriesGraph"]["parameters"]["path"]["id"];

export interface AppDeps {
  db: ContentDB;
}

// Build the content HTTP app. The DB is injected so production wires the node-postgres PgContentDb while
// tests wire a PGlite-backed ContentDB. The adapter never reaches the database directly; every route
// delegates to a handler that owns the ContentDB port.
export function createContentApp(deps: AppDeps): Hono {
  const app = new Hono();
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

  // POST /edges : connect two beats with an optional condition. The handler rejects self-edges and
  // cross-series edges so the graph stays inside one series boundary.
  app.post("/edges", async (c) => {
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const result = await handleCreateEdge(raw as CreateEdgeBody, db);
    return c.json(result.body, result.status as 201 | 400);
  });

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
