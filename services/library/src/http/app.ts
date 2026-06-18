// HTTP adapter for the library service. A thin Hono app over the pure handlers in library.ts. It does
// exactly what the handlers cannot do for themselves, all at the edge:
//
//   1. Authn (the trust boundary). EVERY route resolves the acting user from the session token and passes
//      that verified subject to the handler. No route reads a user id from the body or path; a smuggled
//      user_id is ignored. This is the F1 stance the economy/decision adapters take.
//   2. Parse the JSON body / path params into the handler argument shape.
//   3. Map the handler's {status, body} to an HTTP response.
//
// All ownership scoping and idempotency live below this layer in the pure handlers + the LibraryDB port.
// No em dashes.

import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import {
  handleListSaved,
  handleAddSaved,
  handleRemoveSaved,
  handleListFavorites,
  handleAddFavorite,
  handleRemoveFavorite,
  handleListDownloads,
  handleAddDownload,
  handlePatchDownload,
  handleListChannelFollows,
  handleAddChannelFollow,
  handleRemoveChannelFollow,
  handleGetHistory,
  type LibraryDB,
  type HandlerResult,
} from "../library.js";
import { parseBearer, type Verifiers } from "./auth.js";

export interface AppDeps {
  // The data port, injected. Production wires the node-postgres PgLibraryDb; tests wire a fake pg.
  db: LibraryDB;
  verifiers: Verifiers;
}

// Build the library HTTP app. Every endpoint is authed by the session subject.
export function createLibraryApp(deps: AppDeps): Hono {
  const app = new Hono();
  // Permissive CORS so the consumer app (browser) can call with its bearer token. No cookies.
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type", "authorization", "accept"],
    })
  );
  const { db, verifiers } = deps;

  // Resolve the acting user from the bearer token, run the handler, write the result. On a null identity
  // we answer 401 before touching the handler or the database.
  const authed = (
    run: (userId: string, c: AuthedCtx) => Promise<HandlerResult>
  ) => async (c: AuthedCtx) => {
    const token = parseBearer(c.req.header("authorization"));
    const identity = await verifiers.session.verifySession(token);
    if (identity == null) return c.json({ error: "unauthorized" }, 401);
    const result = await run(identity.userId, c);
    return send(c, result);
  };

  // saved
  app.get("/saved", authed((userId) => handleListSaved(userId, db)));
  app.post("/saved", authed(async (userId, c) => handleAddSaved(userId, await readJson(c), db)));
  app.delete("/saved/:seriesId", authed((userId, c) => handleRemoveSaved(userId, c.req.param("seriesId") ?? "", db)));

  // favorites
  app.get("/favorites", authed((userId) => handleListFavorites(userId, db)));
  app.post("/favorites", authed(async (userId, c) => handleAddFavorite(userId, await readJson(c), db)));
  // DELETE /favorites carries targetType/targetId in the body (a favorite has a composite key).
  app.delete("/favorites", authed(async (userId, c) => handleRemoveFavorite(userId, await readJson(c), db)));

  // downloads
  app.get("/downloads", authed((userId) => handleListDownloads(userId, db)));
  app.post("/downloads", authed(async (userId, c) => handleAddDownload(userId, await readJson(c), db)));
  app.patch("/downloads/:seriesId", authed(async (userId, c) =>
    handlePatchDownload(userId, c.req.param("seriesId") ?? "", await readJson(c), db)
  ));

  // channel follows
  app.get("/channel-follows", authed((userId) => handleListChannelFollows(userId, db)));
  app.post("/channel-follows", authed(async (userId, c) => handleAddChannelFollow(userId, await readJson(c), db)));
  app.delete("/channel-follows/:channelId", authed((userId, c) =>
    handleRemoveChannelFollow(userId, c.req.param("channelId") ?? "", db)
  ));

  // history
  app.get("/history", authed((userId, c) => handleGetHistory(userId, c.req.query("limit"), db)));

  return app;
}

type AuthedCtx = Context;

// Map a handler result to a Hono response. 204 carries no body.
function send(c: AuthedCtx, result: HandlerResult) {
  if (result.status === 204) return c.body(null, 204);
  return c.json(result.body as object, result.status as 200);
}

// Parse a JSON body, returning null on absent or malformed input. The handlers treat null as "no fields"
// and answer 400 with the specific missing-field message, so a parse throw never becomes a 500.
async function readJson(c: AuthedCtx): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}
