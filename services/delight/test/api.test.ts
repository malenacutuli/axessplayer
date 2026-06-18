// DELIGHT API + node:http integration. Exercises the inbox (25-D3) and quest (25-D4) routes over the real
// listener and the HARD gates end to end:
//   - the age gate BLOCKS a minor from a mature/romantic thread;
//   - the paid clue debits idempotently and respects the spend cool-down;
//   - a quest path unlocks the branch (and any path satisfies it);
//   - the community goal aggregates across viewers and unlocks for everyone when met;
//   - self-referral grants nothing;
//   - the AI disclosure flag is present on every message.
// No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { startServer, buildDeps } from "../src/httpServer.js";
import { InMemoryDelightStore } from "../src/store.js";
import { testAgeGate, testEconomyDebit } from "../src/ports.js";
import type { ApiDeps } from "../src/api.js";

const ADULT = "11111111-1111-1111-1111-111111111111";
const MINOR = "22222222-2222-2222-2222-222222222222";
const OTHER = "33333333-3333-3333-3333-333333333333";

function bearer(userId: string): string {
  return `Bearer session:${userId}`;
}

interface Harness {
  base: string;
  store: InMemoryDelightStore;
  setClock: (ms: number) => void;
}

async function withServer(
  fn: (h: Harness) => Promise<void>,
  overrides: Partial<ApiDeps> = {},
): Promise<void> {
  const store = (overrides.store as InMemoryDelightStore) ?? new InMemoryDelightStore();
  let clock = 1_000_000;
  const deps = buildDeps(
    { nodeEnv: "test" },
    {
      store,
      ageGate: overrides.ageGate ?? testAgeGate(new Set([MINOR])),
      economy: overrides.economy ?? testEconomyDebit({ startingBalance: 100 }),
      clueCooldownMs: overrides.clueCooldownMs ?? 60_000,
      cluePriceCredits: overrides.cluePriceCredits ?? 5,
      now: () => clock,
      ...stripStore(overrides),
    },
  );
  const { server, port } = await startServer(deps, 0, "127.0.0.1");
  try {
    await fn({ base: `http://127.0.0.1:${port}`, store, setClock: (ms) => (clock = ms) });
  } finally {
    server.close();
  }
}

// buildDeps already takes store/ageGate/economy/etc as overrides; strip the ones we handle explicitly.
function stripStore(o: Partial<ApiDeps>): Partial<ApiDeps> {
  const { store, ageGate, economy, clueCooldownMs, cluePriceCredits, now, ...rest } = o;
  void store;
  void ageGate;
  void economy;
  void clueCooldownMs;
  void cluePriceCredits;
  void now;
  return rest;
}

async function post(base: string, path: string, body: unknown, auth: string | null): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
async function get(base: string, path: string, auth: string | null): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, { headers: auth ? { authorization: auth } : {} });
  return { status: res.status, json: await res.json() };
}

function seedThread(store: InMemoryDelightStore, id: string, userId: string, matureMode: boolean): void {
  store.seedThread({
    id,
    userId,
    characterId: "char:nova",
    seriesId: null,
    matureMode,
    createdAt: new Date(0).toISOString(),
  });
}

const CONSENT = "consent:nova-actor";

// ---- auth ----

test("unauthenticated request is 401", async () => {
  await withServer(async ({ base }) => {
    const r = await get(base, `/inbox/${ADULT}`, null);
    assert.equal(r.status, 401);
  });
});

test("a non-uuid session subject is rejected (401)", async () => {
  await withServer(async ({ base }) => {
    const r = await get(base, `/inbox/notauuid`, "Bearer session:notauuid");
    assert.equal(r.status, 401);
  });
});

test("inbox is self-scoped: cannot read another viewer's inbox (403)", async () => {
  await withServer(async ({ base }) => {
    const r = await get(base, `/inbox/${OTHER}`, bearer(ADULT));
    assert.equal(r.status, 403);
  });
});

// ---- 25-D3: AI disclosure always present ----

test("every inbox message carries the AI disclosure flag (true)", async () => {
  await withServer(async ({ base, store }) => {
    store.seedMessage({
      id: "m1",
      threadId: "t1",
      userId: ADULT,
      characterId: "char:nova",
      kind: "text",
      body: "Hey, that ending shook me.",
      audioUrl: null,
      branchId: null,
      consentRef: CONSENT,
      c2paRef: null,
      aiDisclosure: true,
      paid: false,
      createdAt: new Date(1).toISOString(),
    });
    const r = await get(base, `/inbox/${ADULT}`, bearer(ADULT));
    assert.equal(r.status, 200);
    assert.equal(r.json.ai_disclosure_enforced, true);
    assert.equal(r.json.messages.length, 1);
    assert.equal(r.json.messages[0].ai_disclosure, true);
  });
});

// ---- 25-D3: HARD age gate ----

test("age gate BLOCKS a minor from a mature thread (choose)", async () => {
  await withServer(async ({ base, store }) => {
    seedThread(store, "tmature", MINOR, true);
    const r = await post(base, `/inbox/tmature/choose`, { branch_id: "b1", consent_ref: CONSENT }, bearer(MINOR));
    assert.equal(r.status, 403);
    assert.equal(r.json.error, "age_restricted");
  });
});

test("age gate BLOCKS a minor from a mature thread (paid clue)", async () => {
  await withServer(async ({ base, store }) => {
    seedThread(store, "tmature", MINOR, true);
    const r = await post(
      base,
      `/inbox/tmature/clue`,
      { client_txn_id: "txn-1", consent_ref: CONSENT },
      bearer(MINOR),
    );
    assert.equal(r.status, 403);
    assert.equal(r.json.error, "age_restricted");
  });
});

test("an adult IS allowed into a mature thread", async () => {
  await withServer(async ({ base, store }) => {
    seedThread(store, "tmature", ADULT, true);
    const r = await post(base, `/inbox/tmature/choose`, { branch_id: "b1", consent_ref: CONSENT }, bearer(ADULT));
    assert.equal(r.status, 201);
    assert.equal(r.json.message.ai_disclosure, true);
    assert.equal(r.json.next_variant_id, "variant:b1");
  });
});

// ---- 25-D3: choose what I do next ----

test("choose applies a branch and appends a disclosed choose_next message", async () => {
  await withServer(async ({ base, store }) => {
    seedThread(store, "t1", ADULT, false);
    const r = await post(base, `/inbox/t1/choose`, { branch_id: "calm", consent_ref: CONSENT }, bearer(ADULT));
    assert.equal(r.status, 201);
    assert.equal(r.json.message.kind, "choose_next");
    assert.equal(r.json.message.branch_id, "calm");
    assert.equal(r.json.message.ai_disclosure, true);
    assert.equal(r.json.next_variant_id, "variant:calm");
  });
});

test("choose with a revoked actor consent is blocked (409)", async () => {
  await withServer(async ({ base, store }) => {
    seedThread(store, "t1", ADULT, false);
    const r = await post(
      base,
      `/inbox/t1/choose`,
      { branch_id: "calm", consent_ref: "consent-revoked:nova" },
      bearer(ADULT),
    );
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "consent_not_current");
  });
});

// ---- 25-D3: paid clue, idempotency + cool-down ----

test("the paid clue debits, is idempotent on client_txn_id, and respects the cool-down", async () => {
  const economy = testEconomyDebit({ startingBalance: 100 });
  await withServer(
    async ({ base, store, setClock }) => {
      seedThread(store, "t1", ADULT, false);

      // First purchase: debits 5 -> balance 95, appends a paid disclosed clue.
      setClock(1_000_000);
      const first = await post(
        base,
        `/inbox/t1/clue`,
        { client_txn_id: "txn-A", consent_ref: CONSENT, body: "look behind the painting" },
        bearer(ADULT),
      );
      assert.equal(first.status, 201);
      assert.equal(first.json.balance, 95);
      assert.equal(first.json.message.kind, "secret_clue");
      assert.equal(first.json.message.paid, true);
      assert.equal(first.json.message.ai_disclosure, true);

      // Idempotent replay of the SAME txn: no second debit (balance unchanged), flagged as a replay.
      const replay = await post(
        base,
        `/inbox/t1/clue`,
        { client_txn_id: "txn-A", consent_ref: CONSENT },
        bearer(ADULT),
      );
      assert.equal(replay.status, 200);
      assert.equal(replay.json.idempotent_replay, true);
      assert.equal(replay.json.balance, 95);

      // A NEW purchase inside the cool-down window (60s) is refused 429, no charge.
      setClock(1_000_000 + 30_000);
      const tooSoon = await post(
        base,
        `/inbox/t1/clue`,
        { client_txn_id: "txn-B", consent_ref: CONSENT },
        bearer(ADULT),
      );
      assert.equal(tooSoon.status, 429);
      assert.equal(tooSoon.json.error, "spend_cooldown_active");

      // After the cool-down a new purchase succeeds and debits again -> 90.
      setClock(1_000_000 + 61_000);
      const second = await post(
        base,
        `/inbox/t1/clue`,
        { client_txn_id: "txn-B", consent_ref: CONSENT },
        bearer(ADULT),
      );
      assert.equal(second.status, 201);
      assert.equal(second.json.balance, 90);

      // Exactly one clue message per distinct successful purchase (txn-A, txn-B) = 2 messages.
      const inbox = await get(base, `/inbox/${ADULT}`, bearer(ADULT));
      const clues = inbox.json.messages.filter((m: any) => m.kind === "secret_clue");
      assert.equal(clues.length, 2);
    },
    { economy, store: new InMemoryDelightStore() },
  );
});

test("the paid clue surfaces insufficient_funds as a paywall (402)", async () => {
  await withServer(
    async ({ base, store }) => {
      seedThread(store, "t1", ADULT, false);
      const r = await post(
        base,
        `/inbox/t1/clue`,
        { client_txn_id: "txn-X", consent_ref: CONSENT },
        bearer(ADULT),
      );
      assert.equal(r.status, 402);
      assert.equal(r.json.error, "insufficient_funds");
      assert.deepEqual(r.json.options, ["buy", "watch_ad", "subscribe"]);
    },
    { economy: testEconomyDebit({ startingBalance: 1 }) },
  );
});

// ---- 25-D4: quest paths ----

test("a watch_ad path unlocks the branch (any path satisfies the unlock)", async () => {
  await withServer(async ({ base }) => {
    const before = await get(base, `/quest/branch-7`, bearer(ADULT));
    assert.equal(before.json.unlocked, false);

    const r = await post(
      base,
      `/quest/branch-7/contribute`,
      { path: "watch_ad", ad_completion_token: "ssv-token-abc" },
      bearer(ADULT),
    );
    assert.equal(r.status, 200);
    assert.equal(r.json.unlocked, true);
    assert.equal(r.json.satisfied_path, "watch_ad");

    const after = await get(base, `/quest/branch-7`, bearer(ADULT));
    assert.equal(after.json.unlocked, true);
  });
});

test("an invite path unlocks; self-referral grants NOTHING", async () => {
  await withServer(async ({ base }) => {
    // Self-referral: invitee_id equals the inviter. Refused, and nothing is unlocked.
    const self = await post(
      base,
      `/quest/branch-9/contribute`,
      { path: "invite", invitee_id: ADULT, first_watch_token: "fw-1" },
      bearer(ADULT),
    );
    assert.equal(self.status, 409);
    assert.equal(self.json.error, "self_referral_forbidden");
    const stillLocked = await get(base, `/quest/branch-9`, bearer(ADULT));
    assert.equal(stillLocked.json.unlocked, false);

    // A genuine invite of another viewer unlocks.
    const good = await post(
      base,
      `/quest/branch-9/contribute`,
      { path: "invite", invitee_id: OTHER, first_watch_token: "fw-1" },
      bearer(ADULT),
    );
    assert.equal(good.status, 200);
    assert.equal(good.json.unlocked, true);
    assert.equal(good.json.satisfied_path, "invite");
  });
});

test("the community goal aggregates across viewers and unlocks for everyone when met", async () => {
  await withServer(async ({ base, store }) => {
    // Seed a goal needing 2 contributions.
    store.seedCommunityGoal({
      branchId: "branch-community",
      targetCount: 2,
      currentCount: 0,
      contributors: [],
      met: false,
    });

    // Viewer 1 contributes: count 1, not yet met, so viewer 1 is NOT yet unlocked.
    const c1 = await post(base, `/quest/branch-community/contribute`, { path: "community_goal" }, bearer(ADULT));
    assert.equal(c1.status, 200);
    assert.equal(c1.json.community_goal.current, 1);
    assert.equal(c1.json.community_goal.met, false);
    assert.equal(c1.json.unlocked, false);

    // The SAME viewer contributing again is idempotent: count does not advance (no self-inflation).
    const dup = await post(base, `/quest/branch-community/contribute`, { path: "community_goal" }, bearer(ADULT));
    assert.equal(dup.json.community_goal.current, 1);

    // Viewer 2 contributes: count 2, goal met. Viewer 2 is unlocked.
    const c2 = await post(base, `/quest/branch-community/contribute`, { path: "community_goal" }, bearer(OTHER));
    assert.equal(c2.json.community_goal.current, 2);
    assert.equal(c2.json.community_goal.met, true);
    assert.equal(c2.json.newly_met, true);
    assert.equal(c2.json.unlocked, true);

    // Now viewer 1 returns: the met goal unlocks the branch for them too.
    const c1again = await post(base, `/quest/branch-community/contribute`, { path: "community_goal" }, bearer(ADULT));
    assert.equal(c1again.json.unlocked, true);
    assert.equal(c1again.json.satisfied_path, "community_goal");
  });
});

test("a spend quest path debits and unlocks, idempotent on replay", async () => {
  await withServer(
    async ({ base }) => {
      const r = await post(
        base,
        `/quest/branch-spend/contribute`,
        { path: "spend", client_txn_id: "qtxn-1" },
        bearer(ADULT),
      );
      assert.equal(r.status, 200);
      assert.equal(r.json.unlocked, true);
      assert.equal(r.json.satisfied_path, "spend");

      // Replay of the same txn does not double-charge and stays unlocked.
      const replay = await post(
        base,
        `/quest/branch-spend/contribute`,
        { path: "spend", client_txn_id: "qtxn-1" },
        bearer(ADULT),
      );
      assert.equal(replay.status, 200);
      assert.equal(replay.json.unlocked, true);
    },
    { economy: testEconomyDebit({ startingBalance: 100 }) },
  );
});

test("an invalid quest path is rejected (400)", async () => {
  await withServer(async ({ base }) => {
    const r = await post(base, `/quest/b/contribute`, { path: "bribe" }, bearer(ADULT));
    assert.equal(r.status, 400);
    assert.equal(r.json.error, "invalid_path");
  });
});

// ---- CORS ----

test("an OPTIONS preflight answers 204 with permissive CORS headers", async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/inbox/${ADULT}`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("access-control-allow-methods"), "GET,POST,PATCH,DELETE,OPTIONS");
    assert.ok((res.headers.get("access-control-allow-headers") ?? "").includes("authorization"));
  });
});
