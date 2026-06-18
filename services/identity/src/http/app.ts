// HTTP adapter for the identity service: the BACKEND of viewer prompt 20-V0 (auth + consent). A thin Hono
// app over the IdentityDb port, the ConsentSink port, and the injected Verifiers. It does at the edge:
//
//   1. C12 auth boundary. A single middleware classifies each route (authBoundary.ts) as anonymous-allowed
//      (feed browse, username availability, the Supabase token exchange) or session-required (profile
//      writes, /me, consent). A session-required route without a valid session bearer answers 401
//      { error: "sign_in_required" }, and stashes the resolved subject so the handler reads it, never the
//      body (the F1 trust boundary, same stance as services/decision).
//   2. POST /auth/verify: verify a Supabase Auth access token, then link/create the mobile.users row by
//      auth_id and report whether the profile is complete.
//   3. GET /profile/username-available: live, case-insensitive availability.
//   4. POST /profile: validate the username shape, persist username/avatar, seed the preference_vector and
//      channel_follows from picks.
//   5. GET /me: the session subject's profile.
//   6. POST /consent: append a consent record to the ConsentSink (trust ledger stub).
//
// No engine/business logic beyond shape validation and orchestration lives here. No em dashes.

import { Hono } from "hono";
import { cors } from "hono/cors";

import { parseBearer, type Verifiers } from "./auth.js";
import { requiresSession } from "./authBoundary.js";
import { isProfileComplete, type IdentityDb, type ProfileRow } from "../identityDb.js";
import { validateUsername } from "../username.js";
import { normalizePicks, seedVectorFromPicks } from "../picks.js";
import type { ConsentSink } from "../consent.js";

export interface AppDeps {
  db: IdentityDb;
  consent: ConsentSink;
  verifiers: Verifiers;
}

// Hono context variable carrying the resolved session subject set by the C12 middleware. Handlers on
// session-required routes read this rather than re-parsing the token, and never trust a body user_id.
type Vars = { sessionUserId: string };

function publicProfile(p: ProfileRow): Record<string, unknown> {
  return {
    id: p.id,
    email: p.email,
    username: p.username,
    avatar_url: p.avatarUrl,
    tier: p.tier,
  };
}

export function createIdentityApp(deps: AppDeps): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();
  const { db, consent, verifiers } = deps;

  // Permissive CORS so the consumer app (browser) can call with its bearer token. No cookies.
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["content-type", "authorization", "accept"],
    }),
  );

  // C12 auth boundary middleware. Anonymous-allowed routes pass through untouched. Session-required routes
  // resolve the subject from the session bearer; a missing/invalid session is 401 sign_in_required.
  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    if (!requiresSession(c.req.method, c.req.path)) return next();
    const token = parseBearer(c.req.header("authorization"));
    const identity = await verifiers.session.verifySession(token);
    if (identity == null) {
      return c.json({ error: "sign_in_required" }, 401);
    }
    c.set("sessionUserId", identity.userId);
    return next();
  });

  app.get("/health", (c) => c.json({ status: "ok" }));

  // POST /auth/verify (anonymous): exchange a Supabase Auth access token for an Axessplayer profile. The
  // JWT is verified behind the injectable AuthTokenVerifier; on success we link/create by auth_id.
  app.post("/auth/verify", async (c) => {
    const token = parseBearer(c.req.header("authorization"));
    const subject = await verifiers.auth.verifyAccessToken(token);
    if (subject == null) {
      return c.json({ error: "invalid_token" }, 401);
    }
    const profile = await db.linkOrCreateByAuthId(subject.authId, subject.email);
    return c.json(
      { user: publicProfile(profile), profile_complete: isProfileComplete(profile) },
      200,
    );
  });

  // GET /profile/username-available?u=NAME (anonymous): live, case-insensitive availability. An
  // ill-shaped username is reported available=false with a reason rather than a 400, so the field can show
  // inline guidance as the viewer types.
  app.get("/profile/username-available", async (c) => {
    const u = c.req.query("u");
    const v = validateUsername(u);
    if (!v.ok) {
      return c.json({ available: false, reason: v.error }, 200);
    }
    const available = await db.usernameAvailable(v.normalized);
    return c.json({ available }, 200);
  });

  // POST /profile (session): create/update the session subject's profile. Validates the username shape,
  // re-checks availability (excluding self), persists, then seeds preference_vector + channel_follows from
  // picks. picks may carry an optional series_id used as the viewer_state key for the seeded vector.
  app.post("/profile", async (c) => {
    const userId = c.get("sessionUserId");
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const body = raw as Record<string, unknown>;

    const v = validateUsername(body.username);
    if (!v.ok) return c.json({ error: "invalid_username", reason: v.error }, 400);

    const available = await db.usernameAvailable(v.normalized, userId);
    if (!available) return c.json({ error: "username_taken" }, 409);

    const avatarUrl =
      typeof body.avatar_url === "string" && body.avatar_url.length > 0 ? body.avatar_url : null;

    const updated = await db.updateProfile(userId, { username: v.normalized, avatarUrl });

    // Seed picks: each pick becomes a channel_follow, and the set seeds a neutral DRAFT preference_vector.
    const picks = normalizePicks(body.picks);
    for (const p of picks) await db.followChannel(userId, p.channelId);
    if (picks.length > 0 && typeof body.series_id === "string" && body.series_id.length > 0) {
      await db.seedPreferenceVector(userId, body.series_id, seedVectorFromPicks(picks));
    }

    return c.json(
      { user: publicProfile(updated), profile_complete: isProfileComplete(updated) },
      200,
    );
  });

  // GET /me (session): the session subject's profile.
  app.get("/me", async (c) => {
    const userId = c.get("sessionUserId");
    const profile = await db.findById(userId);
    if (profile == null) return c.json({ error: "not_found" }, 404);
    return c.json(
      { user: publicProfile(profile), profile_complete: isProfileComplete(profile) },
      200,
    );
  });

  // POST /consent (session): append a consent record to the trust ledger (stubbed ConsentSink). The
  // subject is the session, never the body. Records the decision metadata only, not personal/biometric
  // data (sovereign-plane gate).
  app.post("/consent", async (c) => {
    const userId = c.get("sessionUserId");
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const body = raw as Record<string, unknown>;

    const purpose = typeof body.purpose === "string" ? body.purpose.trim() : "";
    const policyVersion = typeof body.policy_version === "string" ? body.policy_version.trim() : "";
    if (purpose.length === 0 || policyVersion.length === 0) {
      return c.json({ error: "invalid_request" }, 400);
    }
    const granted = body.granted !== false; // default to granted unless explicitly false

    const receipt = await consent.record({
      userId,
      purpose,
      granted,
      policyVersion,
      recordedAt: new Date().toISOString(),
    });
    return c.json({ consent_ref: receipt.consentRef, granted }, 201);
  });

  return app;
}

// Parse a JSON body, returning null on absent or malformed input so the route can answer 400 itself
// rather than letting a parse throw become an unhandled 500. Mirrors services/decision/src/http/app.ts.
async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}
