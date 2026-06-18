// HTTP adapter for the recap service. A thin Hono app over the pure assembleRecap() engine. It does only
// the edge work the engine cannot do for itself:
//
//   1. Authn (the trust boundary). GET /recap/:seriesId resolves the acting viewer from the session bearer
//      token. The viewer_state read is scoped to that subject; a client cannot fetch another viewer's recap.
//   2. Read inputs from the hosted mobile schema via the RecapStore port (viewer_state + cached beat
//      variants), call the pure assembleRecap, and return the selected recap.
//   3. Emit recap_shown on assembly (with beats + variantIds), and accept recap_skipped /
//      continued_after_recap signals, via the EventSink. The engine itself emits nothing.
//
// All selection logic lives below this layer in assembleRecap. This file adds none of it. No em dashes.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { assembleRecap } from "../recap/assemble.js";
import type { RecapStore } from "../store.js";
import {
  type EventSink,
  recapShownEvent,
  recapSkippedEvent,
  continuedAfterRecapEvent,
} from "../events.js";
import { parseBearer, type Verifiers } from "./auth.js";

export interface AppDeps {
  // Read port over the hosted mobile schema. Production wires PgRecapStore; tests wire an in-memory store.
  store: RecapStore;
  // Analytics sink. Production wires a collector/DB-backed sink; tests and local wire ConsoleEventSink.
  events: EventSink;
  verifiers: Verifiers;
  // Injectable clock so event timestamps are deterministic in tests. Defaults to the wall clock.
  now?: () => Date;
}

export function createRecapApp(deps: AppDeps): Hono {
  const app = new Hono();
  // Permissive CORS so the consumer app (browser) can call /recap with its bearer token. No cookies.
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["content-type", "authorization", "accept"],
    }),
  );
  const { store, events, verifiers } = deps;
  const now = deps.now ?? (() => new Date());

  // GET /recap/:seriesId : sessionAuth. Reads the viewer_state for the session subject + the cached beat
  // variants for the series, assembles the recap (pure selection), emits recap_shown, returns the recap.
  app.get("/recap/:seriesId", async (c) => {
    const identity = await verifiers.session.verifySession(parseBearer(c.req.header("authorization")));
    if (identity == null) return c.json({ error: "unauthorized" }, 401);

    const seriesId = c.req.param("seriesId");
    const state = await store.getViewerState(identity.userId, seriesId);
    if (state == null) return c.json({ error: "no_viewer_state" }, 404);

    const pool = await store.getBeatVariants(seriesId);
    const recap = assembleRecap(state, pool);

    await events.emit(
      recapShownEvent({
        userId: identity.userId,
        seriesId,
        beats: recap.beatCount,
        variantIds: recap.variantIds,
        ts: now().toISOString(),
      }),
    );

    return c.json(recap, 200);
  });

  // POST /recap/:seriesId/skipped : the viewer skipped the recap. Emits recap_skipped.
  app.post("/recap/:seriesId/skipped", async (c) => {
    const identity = await verifiers.session.verifySession(parseBearer(c.req.header("authorization")));
    if (identity == null) return c.json({ error: "unauthorized" }, 401);
    await events.emit(
      recapSkippedEvent({ userId: identity.userId, seriesId: c.req.param("seriesId"), ts: now().toISOString() }),
    );
    return c.json({ ok: true }, 200);
  });

  // POST /recap/:seriesId/continued : the viewer continued into the episode after the recap. Emits
  // continued_after_recap.
  app.post("/recap/:seriesId/continued", async (c) => {
    const identity = await verifiers.session.verifySession(parseBearer(c.req.header("authorization")));
    if (identity == null) return c.json({ error: "unauthorized" }, 401);
    await events.emit(
      continuedAfterRecapEvent({
        userId: identity.userId,
        seriesId: c.req.param("seriesId"),
        ts: now().toISOString(),
      }),
    );
    return c.json({ ok: true }, 200);
  });

  return app;
}
