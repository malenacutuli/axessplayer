// HTTP adapter for the decision service. A thin Hono app over the already-hardened decide() handler in
// decide.ts. It does exactly three things the handler cannot do for itself, all at the edge:
//
//   1. Authn (the trust boundary). /decide resolves the acting viewer from the session token and passes
//      it as the handler's user_id. The contract body has a user_id field, but it is NOT trusted: the
//      session subject overrides it, the same F1 stance the economy adapter takes. A client cannot ask
//      for a decision as someone else.
//   2. Parse the JSON body into the handler input shape (typed against the generated contract).
//   3. Map the handler's result to an HTTP response: the contract 200 body verbatim, and the engine's
//      NoSuccessorsError to the contract 422.
//
// The bandit, canon filter, timeout fail-safe, control/opt-out routing, and logging all live below this
// layer in decide(). This file adds none of it and does NOT modify the engine. No em dashes.

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { operations } from "../../../../contracts/types/generated/decision.js";
import {
  decide,
  decideForGuest,
  NoSuccessorsError,
  type DecideDeps,
} from "../decide.js";
import { parseBearer, type Verifiers } from "./auth.js";

// Request/response shapes pinned to the contract (decision.yaml 0.3.1) via the generated types, so the
// route cannot drift from the spec without a type error.
type DecideRequestBody =
  operations["decide"]["requestBody"]["content"]["application/json"];
type DecideResponseBody =
  operations["decide"]["responses"][200]["content"]["application/json"];
type DecideErrorBody =
  operations["decide"]["responses"][422]["content"]["application/json"];

export interface AppDeps {
  // The decision engine dependencies (db, kv, logger, cohorts), injected. Production wires the real
  // Postgres/KV-backed implementations; tests wire the in-memory ones. The adapter never constructs these.
  decisionDeps: DecideDeps;
  verifiers: Verifiers;
}

// Build the decision HTTP app. The engine deps and verifiers are injected so production wires the real
// stores plus a real session verifier, while tests wire in-memory stores plus the test verifier.
export function createDecisionApp(deps: AppDeps): Hono {
  const app = new Hono();
  // Permissive CORS so the consumer app (browser) can call /decide with its bearer token. No cookies.
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["content-type", "authorization", "accept"],
    }),
  );
  const { decisionDeps, verifiers } = deps;

  // POST /decide : sessionAuth. The acting viewer is the session subject, passed to the engine as
  // user_id. The body's user_id (per the contract) is read but overridden by the verified subject, so a
  // client cannot request a decision on behalf of another viewer.
  app.post("/decide", async (c) => {
    const token = parseBearer(c.req.header("authorization"));
    // No token at all = a signed-out viewer: serve the guest director's cut (no per-user state). A token that
    // is present but fails verification is still a 401, so a broken or forged session never looks like a guest.
    const identity = token == null ? null : await verifiers.session.verifySession(token);
    if (token != null && identity == null) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const raw = await readJson(c);
    if (raw == null) {
      return c.json({ error: "invalid_json" }, 400);
    }
    const partial = raw as Partial<DecideRequestBody>;
    if (
      typeof partial.current_beat_id !== "string" ||
      typeof partial.signals !== "object" ||
      partial.signals == null
    ) {
      return c.json({ error: "invalid_request" }, 400);
    }

    try {
      const result =
        identity == null
          ? await decideForGuest(partial.current_beat_id, decisionDeps)
          : await decide(
              // user_id comes from the verified session subject, never the body.
              { user_id: identity.userId, current_beat_id: partial.current_beat_id, signals: partial.signals },
              decisionDeps,
            );
      const body: DecideResponseBody = result.response;
      return c.json(body, 200);
    } catch (err) {
      if (err instanceof NoSuccessorsError) {
        const body: DecideErrorBody = err.body;
        return c.json(body, 422);
      }
      // The engine is fail-safe and degrades internally; a throw here is a genuine adapter-level fault.
      return c.json({ error: "internal_error" }, 500);
    }
  });

  return app;
}

// Parse a JSON body, returning null on absent or malformed input so the route can answer 400 itself
// rather than letting a parse throw become an unhandled 500.
async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}
