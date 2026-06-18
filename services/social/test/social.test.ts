// Route + unit tests over the social Hono app with in-memory fakes (no Postgres). These cover the slice's
// required scenarios:
//   1. a minor is BLOCKED from the mature community (age-gate);
//   2. a UGC write goes to pending (NOT published) under the UNWIRED scanner (fail-CLOSED);
//   3. the rate limit trips;
//   4. report + block work;
//   5. the moderation queue receives the item.
// Plus: a wired clean scanner publishes; a wired block scanner rejects; comments thread; like is
// idempotent; mute hides content; auth boundary returns 401. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createSocialApp, type AppDeps } from "../src/http/app.js";
import { testVerifiers } from "../src/http/auth.js";
import { InMemorySocialDb } from "../src/socialDb.js";
import { FixedWindowRateLimiter, type RateLimiter } from "../src/rateLimit.js";
import { runModeration, type ScanProvider } from "../src/moderation.js";
import { passesAgeGate, type AgeProvider, type AgeBand } from "../src/ageGate.js";

const ADULT = "11111111-1111-1111-1111-111111111111";
const MINOR = "22222222-2222-2222-2222-222222222222";
const OTHER = "33333333-3333-3333-3333-333333333333";
const CHARACTER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SHOW = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// Age provider keyed by user id: ADULT -> adult, everyone else -> minor (so the minor block path is hit).
function ageProviderFor(bands: Record<string, AgeBand>): AgeProvider {
  return {
    async resolve(userId) {
      return { band: bands[userId] ?? "minor" };
    },
  };
}

function bearer(userId: string): Record<string, string> {
  return { authorization: `Bearer session:${userId}`, "content-type": "application/json" };
}

interface Built {
  app: ReturnType<typeof createSocialApp>;
  db: InMemorySocialDb;
}

function build(overrides: Partial<AppDeps> = {}): Built {
  const db = new InMemorySocialDb();
  const deps: AppDeps = {
    db,
    scanner: null, // UNWIRED by default: the fail-closed scenario.
    age: ageProviderFor({ [ADULT]: "adult", [MINOR]: "minor" }),
    rateLimiter: new FixedWindowRateLimiter({ limit: 100, windowMs: 60_000 }),
    verifiers: testVerifiers(),
    ...overrides,
  };
  return { app: createSocialApp(deps), db };
}

// --- pure-unit: the fail-closed moderation contract ----------------------------------------------------

test("moderation: unwired scanner returns pending_provider (fail-closed)", async () => {
  const out = await runModeration({ kind: "post", authorUserId: ADULT, body: "hi" }, null);
  assert.equal(out.status, "pending_provider");
});

test("moderation: an erroring scanner stays fail-closed (pending_provider, never approved)", async () => {
  const boom: ScanProvider = {
    async scan() {
      throw new Error("scanner down");
    },
  };
  const out = await runModeration({ kind: "comment", authorUserId: ADULT, body: "x" }, boom);
  assert.equal(out.status, "pending_provider");
});

test("moderation: only a wired clean verdict publishes; block rejects", async () => {
  const clean: ScanProvider = { async scan() { return { verdict: "clean" }; } };
  const block: ScanProvider = { async scan() { return { verdict: "block", category: "harassment" }; } };
  assert.equal((await runModeration({ kind: "post", authorUserId: ADULT, body: "ok" }, clean)).status, "approved");
  const r = await runModeration({ kind: "post", authorUserId: ADULT, body: "bad" }, block);
  assert.equal(r.status, "rejected");
  assert.equal(r.category, "harassment");
});

test("ageGate: minor and unknown blocked from mature, adult allowed; non-mature open", () => {
  assert.equal(passesAgeGate({ band: "minor" }, true), false);
  assert.equal(passesAgeGate({ band: "unknown" }, true), false);
  assert.equal(passesAgeGate({ band: "adult" }, true), true);
  assert.equal(passesAgeGate({ band: "minor" }, false), true);
});

// --- route: auth boundary ------------------------------------------------------------------------------

test("auth: a write without a session is 401 sign_in_required", async () => {
  const { app } = build();
  const res = await app.fetch(
    new Request("http://social.local/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ character_id: CHARACTER, body: "hi" }),
    }),
  );
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "sign_in_required" });
});

// --- REQUIRED 1: minor blocked from mature community ---------------------------------------------------

test("age-gate: a minor is blocked from posting to a mature community (403)", async () => {
  const { app, db } = build();
  const res = await app.fetch(
    new Request("http://social.local/posts", {
      method: "POST",
      headers: bearer(MINOR),
      body: JSON.stringify({ character_id: CHARACTER, body: "let me in", mature: true }),
    }),
  );
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "age_restricted" });
  // Nothing was stored.
  assert.equal((await db.moderationQueue()).length, 0);
});

test("age-gate: an adult may post to a mature community (passes the gate, lands pending)", async () => {
  const { app } = build();
  const res = await app.fetch(
    new Request("http://social.local/posts", {
      method: "POST",
      headers: bearer(ADULT),
      body: JSON.stringify({ character_id: CHARACTER, body: "adult post", mature: true }),
    }),
  );
  assert.equal(res.status, 202);
  const j = (await res.json()) as { moderation_status: string };
  assert.equal(j.moderation_status, "pending_provider");
});

// --- REQUIRED 2: UGC write goes to pending under the unwired scanner (fail-closed) ---------------------

test("a UGC post under the unwired scanner is stored pending_provider and NOT published", async () => {
  const { app } = build();
  const res = await app.fetch(
    new Request("http://social.local/posts", {
      method: "POST",
      headers: bearer(ADULT),
      body: JSON.stringify({ character_id: CHARACTER, body: "first post" }),
    }),
  );
  assert.equal(res.status, 202);
  const j = (await res.json()) as { moderation_status: string; published: boolean };
  assert.equal(j.moderation_status, "pending_provider");
  assert.equal(j.published, false);
});

test("an unpublished post does NOT appear in the character feed (fail-closed visibility)", async () => {
  const { app } = build();
  await app.fetch(
    new Request("http://social.local/posts", {
      method: "POST",
      headers: bearer(ADULT),
      body: JSON.stringify({ character_id: CHARACTER, body: "hidden until scanned" }),
    }),
  );
  const feed = await app.fetch(
    new Request(`http://social.local/feed/${CHARACTER}`, { headers: bearer(ADULT) }),
  );
  assert.equal(feed.status, 200);
  const j = (await feed.json()) as { posts: unknown[] };
  assert.equal(j.posts.length, 0);
});

test("a comment under the unwired scanner is pending and NOT in the show thread", async () => {
  const { app } = build();
  const res = await app.fetch(
    new Request("http://social.local/comments", {
      method: "POST",
      headers: bearer(ADULT),
      body: JSON.stringify({ show_id: SHOW, body: "great show" }),
    }),
  );
  assert.equal(res.status, 202);
  assert.equal(((await res.json()) as { published: boolean }).published, false);

  const thread = await app.fetch(
    new Request(`http://social.local/comments/${SHOW}`, { headers: bearer(ADULT) }),
  );
  assert.equal(((await thread.json()) as { comments: unknown[] }).comments.length, 0);
});

// A wired clean scanner publishes and the post then shows in the feed; threaded comments sort.
test("a wired clean scanner publishes; feed shows it; comments thread and sort", async () => {
  const clean: ScanProvider = { async scan() { return { verdict: "clean" }; } };
  const { app } = build({ scanner: clean });

  // Two posts.
  await app.fetch(new Request("http://social.local/posts", {
    method: "POST", headers: bearer(ADULT), body: JSON.stringify({ character_id: CHARACTER, body: "p1" }),
  }));
  const feed = await app.fetch(new Request(`http://social.local/feed/${CHARACTER}`, { headers: bearer(ADULT) }));
  assert.equal(((await feed.json()) as { posts: unknown[] }).posts.length, 1);

  // A top comment and a reply.
  const top = await app.fetch(new Request("http://social.local/comments", {
    method: "POST", headers: bearer(ADULT), body: JSON.stringify({ show_id: SHOW, body: "top" }),
  }));
  const topId = ((await top.json()) as { id: string }).id;
  await app.fetch(new Request("http://social.local/comments", {
    method: "POST", headers: bearer(ADULT),
    body: JSON.stringify({ show_id: SHOW, body: "reply", parent_comment_id: topId }),
  }));
  const thread = await app.fetch(new Request(`http://social.local/comments/${SHOW}`, { headers: bearer(ADULT) }));
  const comments = ((await thread.json()) as { comments: Array<{ id: string; parent_comment_id: string | null }> }).comments;
  assert.equal(comments.length, 2);
  // Threaded: top first, its reply second.
  assert.equal(comments[0].id, topId);
  assert.equal(comments[1].parent_comment_id, topId);
});

// --- REQUIRED 3: rate limit trips ----------------------------------------------------------------------

test("rate limit trips after the per-user budget is exhausted (429)", async () => {
  const limiter: RateLimiter = new FixedWindowRateLimiter({ limit: 2, windowMs: 60_000 });
  const { app } = build({ rateLimiter: limiter });
  const post = () =>
    app.fetch(new Request("http://social.local/posts", {
      method: "POST", headers: bearer(ADULT), body: JSON.stringify({ character_id: CHARACTER, body: "spam" }),
    }));
  assert.equal((await post()).status, 202);
  assert.equal((await post()).status, 202);
  const third = await post();
  assert.equal(third.status, 429);
  assert.deepEqual(await third.json(), { error: "rate_limited" });
});

// --- REQUIRED 4: report + block work -------------------------------------------------------------------

test("report enqueues (201, status open) without auto-removing content", async () => {
  const { app, db } = build();
  const res = await app.fetch(new Request("http://social.local/report", {
    method: "POST", headers: bearer(ADULT),
    body: JSON.stringify({ subject_kind: "post", subject_id: CHARACTER, reason: "harassment" }),
  }));
  assert.equal(res.status, 201);
  const j = (await res.json()) as { status: string; id: string };
  assert.equal(j.status, "open");
  assert.equal(db.allReports().length, 1);
  assert.equal(db.allReports()[0].reporterId, ADULT);
});

test("block hides the blocked author from the blocker's feed", async () => {
  const clean: ScanProvider = { async scan() { return { verdict: "clean" }; } };
  const { app } = build({
    scanner: clean,
    age: ageProviderFor({ [ADULT]: "adult", [OTHER]: "adult" }),
  });
  // OTHER posts (published).
  await app.fetch(new Request("http://social.local/posts", {
    method: "POST", headers: bearer(OTHER), body: JSON.stringify({ character_id: CHARACTER, body: "from other" }),
  }));
  // ADULT sees it...
  let feed = await app.fetch(new Request(`http://social.local/feed/${CHARACTER}`, { headers: bearer(ADULT) }));
  assert.equal(((await feed.json()) as { posts: unknown[] }).posts.length, 1);
  // ...blocks OTHER...
  const blk = await app.fetch(new Request("http://social.local/block", {
    method: "POST", headers: bearer(ADULT), body: JSON.stringify({ user_id: OTHER }),
  }));
  assert.equal(blk.status, 200);
  // ...and no longer sees OTHER's post.
  feed = await app.fetch(new Request(`http://social.local/feed/${CHARACTER}`, { headers: bearer(ADULT) }));
  assert.equal(((await feed.json()) as { posts: unknown[] }).posts.length, 0);
});

test("mute hides the muted author's comments from the muter's thread", async () => {
  const clean: ScanProvider = { async scan() { return { verdict: "clean" }; } };
  const { app } = build({
    scanner: clean,
    age: ageProviderFor({ [ADULT]: "adult", [OTHER]: "adult" }),
  });
  await app.fetch(new Request("http://social.local/comments", {
    method: "POST", headers: bearer(OTHER), body: JSON.stringify({ show_id: SHOW, body: "noise" }),
  }));
  await app.fetch(new Request("http://social.local/mute", {
    method: "POST", headers: bearer(ADULT), body: JSON.stringify({ user_id: OTHER }),
  }));
  const thread = await app.fetch(new Request(`http://social.local/comments/${SHOW}`, { headers: bearer(ADULT) }));
  assert.equal(((await thread.json()) as { comments: unknown[] }).comments.length, 0);
});

test("like is idempotent and increments a comment counter once", async () => {
  const clean: ScanProvider = { async scan() { return { verdict: "clean" }; } };
  const { app } = build({ scanner: clean });
  const c = await app.fetch(new Request("http://social.local/comments", {
    method: "POST", headers: bearer(ADULT), body: JSON.stringify({ show_id: SHOW, body: "likeable" }),
  }));
  const id = ((await c.json()) as { id: string }).id;
  const like = () => app.fetch(new Request("http://social.local/like", {
    method: "POST", headers: bearer(ADULT), body: JSON.stringify({ subject_kind: "comment", subject_id: id }),
  }));
  assert.equal(((await (await like()).json()) as { created: boolean }).created, true);
  assert.equal(((await (await like()).json()) as { created: boolean }).created, false);
  const thread = await app.fetch(new Request(`http://social.local/comments/${SHOW}`, { headers: bearer(ADULT) }));
  const comments = ((await thread.json()) as { comments: Array<{ like_count: number }> }).comments;
  assert.equal(comments[0].like_count, 1);
});

// --- REQUIRED 5: the moderation queue receives the item ------------------------------------------------

test("the moderation queue receives an unscanned post and comment", async () => {
  const { app, db } = build();
  await app.fetch(new Request("http://social.local/posts", {
    method: "POST", headers: bearer(ADULT), body: JSON.stringify({ character_id: CHARACTER, body: "queued post" }),
  }));
  await app.fetch(new Request("http://social.local/comments", {
    method: "POST", headers: bearer(ADULT), body: JSON.stringify({ show_id: SHOW, body: "queued comment" }),
  }));
  const queue = await db.moderationQueue();
  assert.equal(queue.length, 2);
  for (const item of queue) {
    assert.equal(item.moderationStatus, "pending_provider");
  }
  assert.ok(queue.some((i) => i.kind === "post"));
  assert.ok(queue.some((i) => i.kind === "comment"));
});
