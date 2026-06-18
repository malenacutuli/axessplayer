// Route tests for the admin HTTP adapter over the real Hono app with a fake pg, the TEST operator
// verifier, and the InMemory audit sink. These prove the trust boundary and the RBAC seam, not the SQL
// math (aggregate.test.ts covers that):
//
//   - no / malformed token -> 401 unauthorized, DB never touched.
//   - a ReadOnly operator may GET /admin/dashboard, but a mutation is 403 (the RBAC seam).
//   - GET /admin/me returns the resolved operator + role.
//   - GET /admin/content/:id with a malformed id is 400 before any DB access.
//
// No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createAdminApp } from "./app.js";
import { testOperatorVerifier } from "../auth.js";
import { InMemoryAuditSink } from "../audit.js";
import type { QueryPort } from "../aggregate.js";

const throwingDb = {
  async query() {
    throw new Error("db must not be touched on the auth/validation reject path");
  },
} as unknown as QueryPort;

function app(db: QueryPort = throwingDb) {
  return createAdminApp({ db, verifier: testOperatorVerifier(), audit: new InMemoryAuditSink() });
}

test("missing token -> 401, DB untouched", async () => {
  const res = await app().request("/admin/me");
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "unauthorized" });
});

test("malformed token (not operator:role:id) -> 401", async () => {
  const res = await app().request("/admin/me", { headers: { authorization: "Bearer garbage" } });
  assert.equal(res.status, 401);
});

test("unknown role in token -> 401", async () => {
  const res = await app().request("/admin/me", { headers: { authorization: "Bearer operator:Wizard:9" } });
  assert.equal(res.status, 401);
});

test("GET /admin/me returns the resolved operator and role", async () => {
  const res = await app().request("/admin/me", { headers: { authorization: "Bearer operator:Finance:op-7" } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { operator: "op-7", role: "Finance" });
});

test("ReadOnly may GET dashboard but a mutation on content is 403 read_only_violation", async () => {
  const db = {
    async query(text: string) {
      // Answer the dashboard aggregates with empty rows; the route only needs to not 500.
      void text;
      return { rows: [] };
    },
  } as unknown as QueryPort;
  const a = app(db);
  const ok = await a.request("/admin/dashboard", { headers: { authorization: "Bearer operator:ReadOnly:r1" } });
  assert.equal(ok.status, 200);

  const denied = await a.request("/admin/content", {
    method: "POST",
    headers: { authorization: "Bearer operator:ReadOnly:r1", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(denied.status, 403);
  const body = (await denied.json()) as { error: string; reason: string };
  assert.equal(body.error, "forbidden");
  assert.equal(body.reason, "read_only_violation");
});

test("GET /admin/content/:id with a malformed id is 400 before DB access", async () => {
  const res = await app().request("/admin/content/not-a-uuid", { headers: { authorization: "Bearer operator:Owner:o1" } });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "invalid_id" });
});

const VALID_UUID = "11111111-1111-1111-1111-111111111111";

test("GET /admin/story-graph/:id with a malformed id is 400 before DB access", async () => {
  const res = await app().request("/admin/story-graph/not-a-uuid", { headers: { authorization: "Bearer operator:Content:c1" } });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "invalid_id" });
});

test("GET /admin/story-graph/:id for an unknown series is 404", async () => {
  const db = {
    async query() {
      return { rows: [] }; // series-by-id read returns no row
    },
  } as unknown as QueryPort;
  const res = await app(db).request(`/admin/story-graph/${VALID_UUID}`, {
    headers: { authorization: "Bearer operator:Content:c1" },
  });
  assert.equal(res.status, 404);
});

test("POST story-graph validate: ReadOnly is 403 (write seam), Content is allowed and audited", async () => {
  // A DB that answers the series existence + empty graph reads.
  const db = {
    async query(text: string) {
      if (/from series where id/.test(text)) return { rows: [{ id: VALID_UUID }] };
      return { rows: [] };
    },
  } as unknown as QueryPort;

  const audit = new InMemoryAuditSink();
  const a = createAdminApp({ db, verifier: testOperatorVerifier(), audit });

  const denied = await a.request(`/admin/story-graph/${VALID_UUID}/validate`, {
    method: "POST",
    headers: { authorization: "Bearer operator:ReadOnly:r1", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json() as { reason: string }).reason, "read_only_violation");

  const ok = await a.request(`/admin/story-graph/${VALID_UUID}/validate`, {
    method: "POST",
    headers: { authorization: "Bearer operator:Content:c1", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { valid: boolean; issues: unknown[] };
  // An empty graph is invalid (empty_graph), proving the solver ran.
  assert.equal(body.valid, false);
  // The write seam was audit-logged.
  assert.equal(audit.entries().length, 1);
  assert.equal(audit.entries()[0].action, "story_graph.validate");
});

test("POST story-graph simulate is RBAC-gated and audited; empty body is a default walk", async () => {
  const db = {
    async query(text: string) {
      if (/from series where id/.test(text)) return { rows: [{ id: VALID_UUID }] };
      return { rows: [] };
    },
  } as unknown as QueryPort;
  const audit = new InMemoryAuditSink();
  const a = createAdminApp({ db, verifier: testOperatorVerifier(), audit });

  const ok = await a.request(`/admin/story-graph/${VALID_UUID}/simulate`, {
    method: "POST",
    headers: { authorization: "Bearer operator:Admin:a1", "content-type": "application/json" },
    body: JSON.stringify({ signals: [] }),
  });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { stoppedReason: string };
  assert.equal(body.stoppedReason, "empty_graph"); // no beats -> empty graph walk
  assert.equal(audit.entries()[0].action, "story_graph.simulate");
});

test("GET /admin/media-factory/jobs and /admin/accessibility are readable", async () => {
  const db = {
    async query() {
      return { rows: [] };
    },
  } as unknown as QueryPort;
  const a = app(db);
  const jobs = await a.request("/admin/media-factory/jobs", { headers: { authorization: "Bearer operator:ReadOnly:r1" } });
  assert.equal(jobs.status, 200);
  assert.equal((await jobs.json() as { source: string }).source, "unwired");

  const a11y = await a.request("/admin/accessibility", { headers: { authorization: "Bearer operator:ReadOnly:r1" } });
  assert.equal(a11y.status, 200);
  const report = (await a11y.json()) as { perTrack: unknown[]; reviewQueueSource: string };
  assert.equal(report.perTrack.length, 4);
  assert.equal(report.reviewQueueSource, "unwired");
});

// ---- Section 7-9 routes -----------------------------------------------------------------------------

test("GET /admin/brands|campaigns|placements are unwired empty arrays (no fabricated rows)", async () => {
  // The ad-plane handlers must NOT issue a DB query (firewall + nothing to read); a throwing db proves it.
  const a = app(throwingDb);
  for (const path of ["/admin/brands", "/admin/campaigns", "/admin/placements"]) {
    const res = await a.request(path, { headers: { authorization: "Bearer operator:Marketing:m1" } });
    assert.equal(res.status, 200, `${path} readable`);
    const body = (await res.json()) as { items: unknown[]; source: string };
    assert.deepEqual(body.items, [], `${path} empty`);
    assert.equal(body.source, "unwired", `${path} unwired`);
  }
});

test("ad-plane write is forbidden for non-marketing roles (firewall + RBAC)", async () => {
  const res = await app().request("/admin/brands", {
    method: "POST",
    headers: { authorization: "Bearer operator:Content:c1", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json() as { reason: string }).reason, "read_only_violation");
});

test("GET /admin/users returns a privacy-minimized page and access-logs the read", async () => {
  const userId = "22222222-2222-2222-2222-222222222222";
  const db = {
    async query(text: string) {
      if (/from users order by created_at/.test(text)) {
        return { rows: [{ id: userId, username: "viewer1", tier: "premium", created_at: "2026-01-01T00:00:00Z" }] };
      }
      if (/count\(\*\)::int as n from users/.test(text)) return { rows: [{ n: 1 }] };
      if (/balance, bonus_balance from coin_wallet/.test(text)) return { rows: [{ user_id: userId, balance: 120, bonus_balance: 5 }] };
      if (/count\(\*\)::int as events from engagement_events group by/.test(text)) return { rows: [{ user_id: userId, events: 42 }] };
      return { rows: [] };
    },
  } as unknown as QueryPort;
  const audit = new InMemoryAuditSink();
  const a = createAdminApp({ db, verifier: testOperatorVerifier(), audit });
  const res = await a.request("/admin/users", { headers: { authorization: "Bearer operator:Support:s1" } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { users: Array<Record<string, unknown>>; total: number };
  assert.equal(body.total, 1);
  assert.equal(body.users[0].username, "viewer1");
  assert.equal(body.users[0].walletBalance, 120);
  assert.equal(body.users[0].engagementEvents, 42);
  // No raw PII (email/auth_id) leaks into the response shape.
  assert.equal((body.users[0] as Record<string, unknown>).email, undefined);
  // The sensitive read was access-logged.
  assert.equal(audit.entries().length, 1);
  assert.equal(audit.entries()[0].action, "users.list");
});

test("GET /admin/users/:id is 400 on malformed id, 404 on unknown, 200 + audit on found", async () => {
  const userId = "33333333-3333-3333-3333-333333333333";
  const bad = await app().request("/admin/users/not-a-uuid", { headers: { authorization: "Bearer operator:Support:s1" } });
  assert.equal(bad.status, 400);

  const emptyDb = { async query() { return { rows: [] }; } } as unknown as QueryPort;
  const missing = await app(emptyDb).request(`/admin/users/${userId}`, { headers: { authorization: "Bearer operator:Support:s1" } });
  assert.equal(missing.status, 404);

  const db = {
    async query(text: string) {
      if (/from users where id/.test(text)) return { rows: [{ id: userId, username: "v", tier: "free", created_at: "2026-01-01T00:00:00Z" }] };
      if (/from coin_wallet where user_id/.test(text)) return { rows: [{ balance: 10, bonus_balance: 0 }] };
      if (/events from engagement_events where user_id/.test(text)) return { rows: [{ events: 3 }] };
      if (/from coin_transactions where user_id/.test(text)) return { rows: [{ transactions: 2, credited: 100, spent: 90 }] };
      return { rows: [] };
    },
  } as unknown as QueryPort;
  const audit = new InMemoryAuditSink();
  const a = createAdminApp({ db, verifier: testOperatorVerifier(), audit });
  const ok = await a.request(`/admin/users/${userId}`, { headers: { authorization: "Bearer operator:Support:s1" } });
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { history: { coinsCredited: number; coinsSpent: number } };
  assert.equal(body.history.coinsCredited, 100);
  assert.equal(body.history.coinsSpent, 90);
  assert.equal(audit.entries()[0].action, "users.detail");
});

test("GET /admin/creators is unwired empty when no ownership column exists", async () => {
  const db = {
    async query(text: string) {
      // The ownership probe returns no column.
      if (/information_schema\.columns/.test(text)) return { rows: [] };
      return { rows: [] };
    },
  } as unknown as QueryPort;
  const res = await app(db).request("/admin/creators", { headers: { authorization: "Bearer operator:Admin:a1" } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { creators: unknown[]; source: string; sharePolicy: { creator: number; platform: number } };
  assert.deepEqual(body.creators, []);
  assert.equal(body.source, "unwired");
  // The 70/30 split policy is surfaced display-only.
  assert.equal(body.sharePolicy.creator, 0.7);
  assert.equal(body.sharePolicy.platform, 0.3);
});

// ---- Destructive seams: audit + 501, never a data write ---------------------------------------------

test("destructive seams audit the attempt and return 501 without ANY DB write", async () => {
  const userId = "44444444-4444-4444-4444-444444444444";
  // A db that THROWS on any query proves the seam never reads or writes data on the happy path.
  const audit = new InMemoryAuditSink();
  const a = createAdminApp({ db: throwingDb, verifier: testOperatorVerifier(), audit });

  const cases: Array<{ path: string; token: string; action: string }> = [
    { path: `/admin/users/${userId}/export`, token: "operator:Admin:a1", action: "gdpr.export" },
    { path: `/admin/users/${userId}/delete`, token: "operator:Owner:o1", action: "gdpr.delete" },
    { path: `/admin/users/${userId}/ban`, token: "operator:Moderation:mod1", action: "user.ban" },
    { path: `/admin/users/${userId}/refund`, token: "operator:Finance:f1", action: "coin.refund" },
  ];

  for (const { path, token, action } of cases) {
    const res = await a.request(path, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 501, `${path} -> 501 not_implemented`);
    const body = (await res.json()) as { error: string; action: string };
    assert.equal(body.error, "not_implemented");
    assert.equal(body.action, action);
  }

  // Each attempt left exactly one audit entry recording that nothing executed.
  const entries = audit.entries();
  assert.equal(entries.length, cases.length);
  for (const e of entries) {
    assert.deepEqual(e.after, { executed: false, reason: "not_implemented" });
  }
  assert.deepEqual(entries.map((e) => e.action), cases.map((c) => c.action));
});

test("destructive seams are RBAC-gated: a non-elevated role is 403 and writes no audit", async () => {
  const userId = "55555555-5555-5555-5555-555555555555";
  const audit = new InMemoryAuditSink();
  const a = createAdminApp({ db: throwingDb, verifier: testOperatorVerifier(), audit });
  // Support owns the users READ surface but must NOT run a gdpr delete (elevated write only).
  const res = await a.request(`/admin/users/${userId}/delete`, {
    method: "POST",
    headers: { authorization: "Bearer operator:Support:s1", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json() as { reason: string }).reason, "role_forbidden");
  // RBAC denied before the handler, so no audit entry was written.
  assert.equal(audit.entries().length, 0);
});

test("destructive seam with a malformed id is 400 before audit", async () => {
  const audit = new InMemoryAuditSink();
  const a = createAdminApp({ db: throwingDb, verifier: testOperatorVerifier(), audit });
  const res = await a.request("/admin/users/not-a-uuid/delete", {
    method: "POST",
    headers: { authorization: "Bearer operator:Admin:a1", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 400);
  assert.equal(audit.entries().length, 0);
});
