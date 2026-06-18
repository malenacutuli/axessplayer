// HTTP adapter for the social service: the BACKEND of viewer prompt 20-V8 (social/community). A thin Hono
// app over the SocialDb port, the moderation pipeline (ScanProvider), the age-gate (AgeProvider), the rate
// limiter, and the injected session Verifiers. This is the HIGHEST-RISK viewer surface; the adapter is
// where the hard gates are enforced at the edge:
//
//   1. SESSION AUTH. Every route is session-authed. A request without a valid session bearer answers 401
//      { error: "sign_in_required" }. The acting viewer is the session subject, never a body field.
//   2. AGE-GATE. A minor (or an unknown age band, fail-closed) is BLOCKED from mature community content,
//      both reading a mature feed and posting to a mature community. 403 { error: "age_restricted" }.
//   3. RATE LIMIT. Every UGC write (post, comment) consumes a per-user budget BEFORE the moderation
//      pipeline runs; an exhausted budget answers 429 { error: "rate_limited" } so a flood cannot saturate
//      the scanner or queue.
//   4. FAIL-CLOSED MODERATION. Every UGC write runs through runModeration -> a ScanProvider BEFORE
//      publish. The write is stored as pending; with no provider wired it stays 'pending_provider' and is
//      NEVER published. The route returns the moderation status so the client shows "pending review".
//   5. REPORT + BLOCK + MUTE. A report enqueues for the human moderation queue (never auto-removes). Block
//      and mute are the viewer-side safety primitives.
//
// No engine/business logic beyond shape validation and orchestration lives here. No em dashes.

import { Hono } from "hono";
import { cors } from "hono/cors";

import { parseBearer, type Verifiers } from "./auth.js";
import type { SocialDb, CommentSort } from "../socialDb.js";
import { runModeration, type ScanProvider, type UgcKind } from "../moderation.js";
import { passesAgeGate, type AgeProvider } from "../ageGate.js";
import type { RateLimiter } from "../rateLimit.js";

export interface AppDeps {
  db: SocialDb;
  // null means NO scanner is wired: UGC stays pending_provider (fail-closed), never auto-clean.
  scanner: ScanProvider | null;
  age: AgeProvider;
  rateLimiter: RateLimiter;
  verifiers: Verifiers;
}

// Hono context variable carrying the resolved session subject set by the auth middleware.
type Vars = { sessionUserId: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 4000;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function cleanBody(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length === 0 || s.length > MAX_BODY) return null;
  return s;
}

export function createSocialApp(deps: AppDeps): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();
  const { db, scanner, age, rateLimiter, verifiers } = deps;

  // Permissive CORS so the consumer app (browser) can call with its bearer token. Mirrors the CORS-OK
  // services (content/identity/catalog): respond to OPTIONS with 204 and set access-control-allow-origin:*
  // on every response, allow-headers content-type,authorization,accept, methods incl PATCH/DELETE.
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type", "authorization", "accept"],
    }),
  );

  // Session auth boundary. Health and OPTIONS pass; everything else requires a valid session bearer.
  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    if (c.req.path === "/health") return next();
    const token = parseBearer(c.req.header("authorization"));
    const identity = await verifiers.session.verifySession(token);
    if (identity == null) {
      return c.json({ error: "sign_in_required" }, 401);
    }
    c.set("sessionUserId", identity.userId);
    return next();
  });

  app.get("/health", (c) => c.json({ status: "ok" }));

  // POST /posts (session): a verified character post. Order of gates: age-gate (mature community blocked
  // for minors) -> rate limit -> moderation pipeline. The post is stored pending and is NOT published; the
  // response carries the moderation status. The author is the session subject (the operator posting AS the
  // character); the character-verification check is an operator-plane concern injected upstream.
  app.post("/posts", async (c) => {
    const userId = c.get("sessionUserId");
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const body = raw as Record<string, unknown>;

    if (!isUuid(body.character_id)) return c.json({ error: "invalid_request" }, 400);
    const text = cleanBody(body.body);
    if (text == null) return c.json({ error: "invalid_request" }, 400);
    const mature = body.mature === true;
    const mediaUrl =
      typeof body.media_url === "string" && body.media_url.length > 0 ? body.media_url : null;

    // Age-gate: a minor (or unknown band) may not post to a mature community.
    const viewerAge = await age.resolve(userId);
    if (!passesAgeGate(viewerAge, mature)) {
      return c.json({ error: "age_restricted" }, 403);
    }

    // Rate limit BEFORE the scanner so a flood cannot saturate moderation.
    if (!rateLimiter.allow(userId, "post")) {
      return c.json({ error: "rate_limited" }, 429);
    }

    // Fail-closed moderation: scan BEFORE publish. With no provider wired -> pending_provider, unpublished.
    const outcome = await runModeration(
      { kind: "post", authorUserId: userId, body: text, mediaUrl },
      scanner,
    );

    const row = await db.insertPost({
      characterId: body.character_id,
      authorUserId: userId,
      body: text,
      mediaUrl,
      mature,
      moderationStatus: outcome.status,
    });

    // 202 Accepted: the write is recorded but NOT (yet) published. published is true only when approved.
    return c.json(
      { id: row.id, moderation_status: row.moderationStatus, published: row.moderationStatus === "approved" },
      202,
    );
  });

  // POST /comments (session): a threaded comment on a show. parent_comment_id (optional) makes it a reply.
  // Same gate order as posts: rate limit -> moderation pipeline (no maturity field on comments here; the
  // age-gate applies at the community/show level the client already gated on read).
  app.post("/comments", async (c) => {
    const userId = c.get("sessionUserId");
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const body = raw as Record<string, unknown>;

    if (!isUuid(body.show_id)) return c.json({ error: "invalid_request" }, 400);
    const text = cleanBody(body.body);
    if (text == null) return c.json({ error: "invalid_request" }, 400);
    const parentCommentId =
      body.parent_comment_id == null
        ? null
        : isUuid(body.parent_comment_id)
          ? body.parent_comment_id
          : undefined;
    if (parentCommentId === undefined) return c.json({ error: "invalid_request" }, 400);

    if (!rateLimiter.allow(userId, "comment")) {
      return c.json({ error: "rate_limited" }, 429);
    }

    const outcome = await runModeration({ kind: "comment", authorUserId: userId, body: text }, scanner);

    const row = await db.insertComment({
      showId: body.show_id,
      parentCommentId,
      authorUserId: userId,
      body: text,
      moderationStatus: outcome.status,
    });

    return c.json(
      { id: row.id, moderation_status: row.moderationStatus, published: row.moderationStatus === "approved" },
      202,
    );
  });

  // GET /feed/:characterId (session): the verified character's feed (APPROVED, non-deleted posts only;
  // blocked/muted authors filtered). Age-gate: a minor sees no mature feed. We follow the character on a
  // ?follow=1 query as a convenience for the follow action.
  app.get("/feed/:characterId", async (c) => {
    const userId = c.get("sessionUserId");
    const characterId = c.req.param("characterId");
    if (!isUuid(characterId)) return c.json({ error: "invalid_request" }, 400);

    if (c.req.query("follow") === "1") {
      await db.followCharacter(userId, characterId);
    }

    const posts = await db.feedForCharacter(characterId, userId);

    // Age-gate the visible set: a minor (or unknown band) never receives mature posts. Non-mature posts
    // pass for everyone. Done here so the gate holds even if a mature post slipped past on write.
    const viewerAge = await age.resolve(userId);
    const visible = posts.filter((p) => passesAgeGate(viewerAge, p.mature));

    return c.json(
      {
        character_id: characterId,
        posts: visible.map((p) => ({
          id: p.id,
          author_user_id: p.authorUserId,
          body: p.body,
          media_url: p.mediaUrl,
          created_at: p.createdAt,
        })),
      },
      200,
    );
  });

  // POST /follow (session): follow a character feed. Idempotent. Kept distinct from the feed convenience.
  app.post("/follow", async (c) => {
    const userId = c.get("sessionUserId");
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const body = raw as Record<string, unknown>;
    if (!isUuid(body.character_id)) return c.json({ error: "invalid_request" }, 400);
    await db.followCharacter(userId, body.character_id);
    return c.json({ ok: true }, 200);
  });

  // GET /comments/:showId (session): threaded comments on a show. sort=top|newest (default newest).
  app.get("/comments/:showId", async (c) => {
    const userId = c.get("sessionUserId");
    const showId = c.req.param("showId");
    if (!isUuid(showId)) return c.json({ error: "invalid_request" }, 400);
    const sort: CommentSort = c.req.query("sort") === "top" ? "top" : "newest";
    const comments = await db.commentsForShow(showId, userId, sort);
    return c.json(
      {
        show_id: showId,
        sort,
        comments: comments.map((cm) => ({
          id: cm.id,
          parent_comment_id: cm.parentCommentId,
          author_user_id: cm.authorUserId,
          body: cm.body,
          like_count: cm.likeCount,
          created_at: cm.createdAt,
        })),
      },
      200,
    );
  });

  // POST /like (session): idempotent like on a post or comment.
  app.post("/like", async (c) => {
    const userId = c.get("sessionUserId");
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const body = raw as Record<string, unknown>;
    const kind = body.subject_kind;
    if (kind !== "post" && kind !== "comment") return c.json({ error: "invalid_request" }, 400);
    if (!isUuid(body.subject_id)) return c.json({ error: "invalid_request" }, 400);
    const created = await db.like(userId, kind as UgcKind, body.subject_id);
    return c.json({ ok: true, created }, 200);
  });

  // POST /report (session): file a moderation report. Enqueues for the human moderation queue; NEVER
  // auto-removes content (human-in-the-loop).
  app.post("/report", async (c) => {
    const userId = c.get("sessionUserId");
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const body = raw as Record<string, unknown>;
    const kind = body.subject_kind;
    if (kind !== "post" && kind !== "comment") return c.json({ error: "invalid_request" }, 400);
    if (!isUuid(body.subject_id)) return c.json({ error: "invalid_request" }, 400);
    const reason = cleanBody(body.reason);
    if (reason == null) return c.json({ error: "invalid_request" }, 400);
    const { id } = await db.insertReport({
      reporterId: userId,
      subjectKind: kind as UgcKind,
      subjectId: body.subject_id,
      reason,
    });
    return c.json({ id, status: "open" }, 201);
  });

  // POST /block (session): block another user. The session subject is the blocker, never a body field.
  app.post("/block", async (c) => {
    const userId = c.get("sessionUserId");
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const body = raw as Record<string, unknown>;
    if (!isUuid(body.user_id)) return c.json({ error: "invalid_request" }, 400);
    if (body.user_id === userId) return c.json({ error: "invalid_request" }, 400);
    await db.block(userId, body.user_id);
    return c.json({ ok: true }, 200);
  });

  // POST /mute (session): mute another user.
  app.post("/mute", async (c) => {
    const userId = c.get("sessionUserId");
    const raw = await readJson(c);
    if (raw == null) return c.json({ error: "invalid_json" }, 400);
    const body = raw as Record<string, unknown>;
    if (!isUuid(body.user_id)) return c.json({ error: "invalid_request" }, 400);
    if (body.user_id === userId) return c.json({ error: "invalid_request" }, 400);
    await db.mute(userId, body.user_id);
    return c.json({ ok: true }, 200);
  });

  return app;
}

// Parse a JSON body, returning null on absent or malformed input. Mirrors services/identity.
async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}
