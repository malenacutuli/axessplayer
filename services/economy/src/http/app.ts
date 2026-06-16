// HTTP adapter for the economy service. A thin Hono app over the already-hardened handlers in
// economy.ts. It does exactly three things the handlers cannot do for themselves, all at the edge:
//
//   1. Authn/authz (the F1 trust boundary). /wallet and /spend resolve the acting user from the session
//      token and pass it as the handler's userId; there is no user_id in those request bodies, by design.
//      /grant is server-to-server only: it requires the trusted service role and returns 403 otherwise.
//   2. Parse JSON bodies into the handler input shapes (typed against the generated contract).
//   3. Map each handler's { status, body } to an HTTP response verbatim.
//
// Business logic, pricing, idempotency, own-once and insufficient-funds -> 402 all live below this layer
// in spend_coins/grant_coins and the handlers. This file adds none of it. No em dashes.

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { paths } from "../../../../contracts/types/generated/economy.js";
import {
  handleGetWallet,
  handleSpend,
  handleGrant,
  type EconomyDB,
  type SpendBody,
  type GrantBody,
} from "../economy.js";
import { parseBearer, type Verifiers } from "./auth.js";

// Request/response shapes pinned to the contract (economy.yaml 0.3.2) via the generated types, so the
// routes cannot drift from the spec without a type error.
type SpendRequest = paths["/spend"]["post"]["requestBody"]["content"]["application/json"];
type GrantRequest = paths["/grant"]["post"]["requestBody"]["content"]["application/json"];

export interface AppDeps {
  db: EconomyDB;
  verifiers: Verifiers;
}

// Build the economy HTTP app. The DB and verifiers are injected so production wires the service-role
// PgEconomyDb plus a real JWKS verifier, while tests wire a PGlite DB plus the test verifiers.
export function createEconomyApp(deps: AppDeps): Hono {
  const app = new Hono();
  // Permissive CORS so the consumer app (browser, different localhost port) can call /wallet and /spend with
  // its bearer token. No cookies, so origin "*" is safe.
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["content-type", "authorization", "accept"],
    }),
  );
  const { db, verifiers } = deps;

  // GET /wallet : sessionAuth. Self-scoped to the token subject. No user id input exists (F1).
  app.get("/wallet", async (c) => {
    const token = parseBearer(c.req.header("authorization"));
    const identity = await verifiers.session.verifySession(token);
    if (identity == null) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const result = await handleGetWallet(identity.userId, db);
    return c.json(result.body, result.status as 200 | 404);
  });

  // POST /spend : sessionAuth. The acting user is the session subject, passed to the handler. The body
  // carries scope, scope_id, client_txn_id only; any user_id a client tries to smuggle is ignored
  // because the handler is never given a body-derived identity.
  app.post("/spend", async (c) => {
    const token = parseBearer(c.req.header("authorization"));
    const identity = await verifiers.session.verifySession(token);
    if (identity == null) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const raw = await readJson(c);
    if (raw == null) {
      return c.json({ error: "invalid_json" }, 400);
    }
    // Project only the contract fields into the handler input. user_id, if present, is intentionally
    // dropped here and never reaches spend_coins.
    const body: SpendBody = {
      scope: (raw as Partial<SpendRequest>).scope as SpendBody["scope"],
      scope_id: (raw as Partial<SpendRequest>).scope_id as string,
      client_txn_id: (raw as Partial<SpendRequest>).client_txn_id as string,
    };
    const result = await handleSpend(identity.userId, body, db);
    return c.json(result.body, result.status as 200 | 400 | 402 | 404 | 409);
  });

  // POST /grant : serviceAuth. Server-to-server only. Without the trusted service role, 403, before any
  // DB access. user_id here is the verified subject the trusted caller supplies (per the contract), so it
  // is read from the body, unlike /spend.
  app.post("/grant", async (c) => {
    const token = parseBearer(c.req.header("authorization"));
    const isService = await verifiers.service.verifyService(token);
    if (!isService) {
      return c.json({ error: "forbidden" }, 403);
    }
    const raw = await readJson(c);
    if (raw == null) {
      return c.json({ error: "invalid_json" }, 400);
    }
    const body: GrantBody = {
      user_id: (raw as Partial<GrantRequest>).user_id as string,
      amount: (raw as Partial<GrantRequest>).amount as number,
      type: (raw as Partial<GrantRequest>).type as GrantBody["type"],
      client_txn_id: (raw as Partial<GrantRequest>).client_txn_id as string,
    };
    const result = await handleGrant(body, db);
    return c.json(result.body, result.status as 200 | 400 | 404);
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
