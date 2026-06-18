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

test("GET /admin/brands|campaigns|placements|performance are unwired empty arrays when the rail is unapplied", async () => {
  // The brand rail tables are not applied: the table probe returns no rows, so each handler returns the
  // empty + source:"unwired" shape (no fabricated rows). The probe reads only information_schema.
  const db = {
    async query(text: string) {
      assert.match(text, /information_schema\.tables/, "only the catalog probe runs when the rail is absent");
      return { rows: [] };
    },
  } as unknown as QueryPort;
  const a = app(db);
  for (const path of ["/admin/brands", "/admin/campaigns", "/admin/placements", "/admin/brands/performance"]) {
    const res = await a.request(path, { headers: { authorization: "Bearer operator:Marketing:m1" } });
    assert.equal(res.status, 200, `${path} readable`);
    const body = (await res.json()) as { items: unknown[]; source: string };
    assert.deepEqual(body.items, [], `${path} empty`);
    assert.equal(body.source, "unwired", `${path} unwired`);
  }
});

test("GET /admin/brands|campaigns|placements|performance return real rows when the rail is applied", async () => {
  const db = {
    async query(text: string) {
      if (/information_schema\.tables/.test(text)) return { rows: [{ table_name: "x" }] };
      if (/from brand_accounts/.test(text)) return { rows: [{ id: "b1", name: "Acme", status: "active" }] };
      if (/from brand_campaigns/.test(text)) {
        return { rows: [{ id: "c1", brand_id: "b1", name: "Spring", status: "live", starts_at: "2026-01-01T00:00:00Z", ends_at: null }] };
      }
      if (/from placement_slots/.test(text)) return { rows: [{ id: "p1", campaign_id: "c1", slot: "cafe-table", status: "filled" }] };
      if (/from brand_performance/.test(text)) return { rows: [{ campaign_id: "c1", impressions: 100, completions: 80, brand_recall: 12 }] };
      return { rows: [] };
    },
  } as unknown as QueryPort;
  const a = app(db);
  const brands = (await (await a.request("/admin/brands", { headers: { authorization: "Bearer operator:Marketing:m1" } })).json()) as { items: Array<Record<string, unknown>>; source: string };
  assert.equal(brands.source, "hosted");
  assert.equal(brands.items[0].name, "Acme");
  const perf = (await (await a.request("/admin/brands/performance", { headers: { authorization: "Bearer operator:Marketing:m1" } })).json()) as { items: Array<Record<string, unknown>>; source: string };
  assert.equal(perf.source, "hosted");
  assert.equal(perf.items[0].impressions, 100);
  assert.equal(perf.items[0].brandRecall, 12);
});

test("brand-rail reads are readable by every operator role (read-broad RBAC)", async () => {
  const db = {
    async query() {
      return { rows: [] };
    },
  } as unknown as QueryPort;
  const a = app(db);
  for (const role of ["ReadOnly", "Support", "Content"]) {
    const res = await a.request("/admin/brands/performance", { headers: { authorization: `Bearer operator:${role}:u1` } });
    assert.equal(res.status, 200, `${role} may read brand performance`);
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

// ---- Section 10-12 routes: monetization, analytics, growth ------------------------------------------

const emptyDb = { async query() { return { rows: [] }; } } as unknown as QueryPort;

test("GET /admin/monetization returns the rule set with display-only, non-editable reward weights", async () => {
  const res = await app(emptyDb).request("/admin/monetization", { headers: { authorization: "Bearer operator:Finance:f1" } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { rules: unknown[]; rewardWeights: { editable: boolean }; rulesSource: string };
  assert.ok(body.rules.length > 0);
  assert.equal(body.rulesSource, "default");
  // HARD GATE at the HTTP layer: reward weights are display-only and not editable.
  assert.equal(body.rewardWeights.editable, false);
});

test("HARD GATE: reward weights are NEVER writable: a pricing edit is a 501 audit seam and the payload exposes no editable weight", async () => {
  const audit = new InMemoryAuditSink();
  const a = createAdminApp({ db: emptyDb, verifier: testOperatorVerifier(), audit });

  // A Finance operator may reach the pricing-edit seam (RBAC write), but it is a 501 that mutates nothing.
  const seam = await a.request("/admin/monetization/pricing", {
    method: "POST",
    headers: { authorization: "Bearer operator:Finance:f1", "content-type": "application/json" },
    body: JSON.stringify({ id: "pack_small", amount: 1 }),
  });
  assert.equal(seam.status, 501);
  assert.equal((await seam.json() as { error: string }).error, "not_implemented");
  // The attempt was audited, nothing executed.
  assert.equal(audit.entries().length, 1);
  assert.deepEqual(audit.entries()[0].after, { executed: false, reason: "not_implemented" });

  // There is NO route that writes a reward weight at all: a PATCH that tries to target weights still hits the
  // pricing seam (501), never a weight mutation, and the GET payload carries no editable weight field.
  const view = await a.request("/admin/monetization", { headers: { authorization: "Bearer operator:Owner:o1" } });
  const body = (await view.json()) as { rewardWeights: Record<string, unknown> };
  assert.equal(body.rewardWeights.editable, false);
  assert.equal(body.rewardWeights["value"], undefined);
  assert.equal(body.rewardWeights["weights"], undefined);
});

test("pricing edit is RBAC-forbidden for a non-finance role (read-only violation, no audit)", async () => {
  const audit = new InMemoryAuditSink();
  const a = createAdminApp({ db: emptyDb, verifier: testOperatorVerifier(), audit });
  // Marketing reads monetization but cannot edit pricing (finance-gated write).
  const res = await a.request("/admin/monetization/pricing", {
    method: "POST",
    headers: { authorization: "Bearer operator:Marketing:m1", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json() as { reason: string }).reason, "read_only_violation");
  assert.equal(audit.entries().length, 0);
});

test("GET /admin/analytics defaults to the funnel and accepts a dim; lift is a band, never a point", async () => {
  // Default funnel.
  const funnelDb = {
    async query(text: string) {
      if (/from engagement_events/.test(text)) return { rows: [{ impression: 100, play: 40, view_3s: 30, completion_50: 15, episode_completed: 10, unlock: 1 }] };
      return { rows: [] };
    },
  } as unknown as QueryPort;
  const a = app(funnelDb);
  const def = await a.request("/admin/analytics", { headers: { authorization: "Bearer operator:ReadOnly:r1" } });
  assert.equal(def.status, 200);
  const defBody = (await def.json()) as { dim: string; stages: unknown[] };
  assert.equal(defBody.dim, "funnel");
  assert.equal(defBody.stages.length, 6);

  // Branch dim: lift comes back as a band triplet.
  const branchDb = {
    async query(text: string) {
      if (/from decision_log/.test(text)) return { rows: [{ beat_id: "b1", treatment_trials: 100, treatment_success: 80, control_trials: 100, control_success: 20 }] };
      return { rows: [] };
    },
  } as unknown as QueryPort;
  const br = await app(branchDb).request("/admin/analytics?dim=branch", { headers: { authorization: "Bearer operator:Admin:a1" } });
  assert.equal(br.status, 200);
  const brBody = (await br.json()) as { dim: string; branches: Array<{ lift: { low: number; high: number; center: number } }> };
  assert.equal(brBody.dim, "branch");
  const lift = brBody.branches[0].lift;
  assert.ok(typeof lift.low === "number" && typeof lift.high === "number" && typeof lift.center === "number");
  assert.ok(lift.low <= lift.center && lift.center <= lift.high);
});

test("analytics is a broad-read surface: even ReadOnly can read it", async () => {
  const res = await app(emptyDb).request("/admin/analytics?dim=a11y", { headers: { authorization: "Bearer operator:ReadOnly:r1" } });
  assert.equal(res.status, 200);
});

test("GET /admin/growth: referral health from referrals, creative bandit + acquisition unwired", async () => {
  const db = {
    async query(text: string) {
      if (/information_schema\.tables/.test(text)) return { rows: [] };
      if (/from referrals/.test(text)) return { rows: [{ invited: 10, joined: 4, first_watch: 1, reward_granted: 1, total: 15 }] };
      return { rows: [] };
    },
  } as unknown as QueryPort;
  const res = await app(db).request("/admin/growth", { headers: { authorization: "Bearer operator:Marketing:m1" } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    creativeBandit: { source: string };
    acquisition: { source: string; channels: unknown[] };
    referrals: { invited: number };
  };
  assert.equal(body.creativeBandit.source, "unwired");
  assert.equal(body.acquisition.source, "unwired");
  assert.deepEqual(body.acquisition.channels, []);
  assert.equal(body.referrals.invited, 10);
});

// ---- Section 13-15 routes: moderation, trust, finance -----------------------------------------------

const probeEmptyDb = {
  async query(text: string) {
    void text;
    return { rows: [] };
  },
} as unknown as QueryPort;

test("GET /admin/moderation/queue is unwired empty (no social tables) and surfaces the scan provider", async () => {
  const res = await app(probeEmptyDb).request("/admin/moderation/queue", { headers: { authorization: "Bearer operator:Moderation:mod1" } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { items: unknown[]; source: string; scanProvider: string };
  assert.deepEqual(body.items, []);
  assert.equal(body.source, "unwired");
  assert.equal(body.scanProvider, "unwired");
});

test("GET /admin/moderation/policy returns the documented policy and pending_provider scan status", async () => {
  // The policy is pure; a throwing db proves it issues no query.
  const res = await app(throwingDb).request("/admin/moderation/policy", { headers: { authorization: "Bearer operator:ReadOnly:r1" } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ageGate: { minViewAge: number }; communityRules: unknown[]; scanProvider: { status: string } };
  assert.ok(body.communityRules.length > 0);
  assert.equal(typeof body.ageGate.minViewAge, "number");
  // HARD GATE: the scan provider is reported as pending_provider, never a clean enforcement.
  assert.equal(body.scanProvider.status, "pending_provider");
});

test("moderation action seams 501 + audit without a data write; RBAC-gated to moderation roles", async () => {
  const ugcId = "66666666-6666-6666-6666-666666666666";
  const audit = new InMemoryAuditSink();
  const a = createAdminApp({ db: throwingDb, verifier: testOperatorVerifier(), audit });

  const actions: Array<{ verb: string; action: string }> = [
    { verb: "approve", action: "moderation.approve" },
    { verb: "remove", action: "moderation.remove" },
    { verb: "escalate", action: "moderation.escalate" },
    { verb: "block", action: "moderation.block" },
    { verb: "takedown", action: "moderation.takedown" },
  ];
  for (const { verb, action } of actions) {
    const res = await a.request(`/admin/moderation/items/${ugcId}/${verb}`, {
      method: "POST",
      headers: { authorization: "Bearer operator:Moderation:mod1", "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 501, `${verb} -> 501`);
    assert.equal((await res.json() as { action: string }).action, action);
  }
  const entries = audit.entries();
  assert.equal(entries.length, actions.length);
  for (const e of entries) assert.deepEqual(e.after, { executed: false, reason: "not_implemented" });

  // A non-moderation role (Support reads but cannot run a takedown) is 403 and writes no audit.
  const audit2 = new InMemoryAuditSink();
  const a2 = createAdminApp({ db: throwingDb, verifier: testOperatorVerifier(), audit: audit2 });
  const denied = await a2.request(`/admin/moderation/items/${ugcId}/takedown`, {
    method: "POST",
    headers: { authorization: "Bearer operator:Support:s1", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json() as { reason: string }).reason, "read_only_violation");
  assert.equal(audit2.entries().length, 0);
});

test("GET /admin/trust/consent is minimized + unwired and access-logs the read", async () => {
  const audit = new InMemoryAuditSink();
  const a = createAdminApp({ db: probeEmptyDb, verifier: testOperatorVerifier(), audit });
  const res = await a.request("/admin/trust/consent", { headers: { authorization: "Bearer operator:Admin:a1" } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { entries: unknown[]; source: string; minimized: boolean };
  assert.deepEqual(body.entries, []);
  assert.equal(body.source, "unwired");
  assert.equal(body.minimized, true);
  // The sensitive consent read was access-logged (who looked, when), carrying only non-PII metadata.
  assert.equal(audit.entries().length, 1);
  assert.equal(audit.entries()[0].action, "trust.consent.read");
  assert.equal((audit.entries()[0].after as { source: string }).source, "unwired");
});

test("GET /admin/trust/provenance is readable and unwired when the substrate is absent", async () => {
  const res = await app(probeEmptyDb).request("/admin/trust/provenance", { headers: { authorization: "Bearer operator:ReadOnly:r1" } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { source: string; rollup: { total: number } };
  assert.equal(body.source, "unwired");
  assert.equal(body.rollup.total, 0);
});

test("trust destructive seams (consent hard-delete, GDPR delete) 501 + audit; Admin/Owner only", async () => {
  const id = "77777777-7777-7777-7777-777777777777";
  const audit = new InMemoryAuditSink();
  const a = createAdminApp({ db: throwingDb, verifier: testOperatorVerifier(), audit });

  const consentDel = await a.request(`/admin/trust/consent/${id}/delete`, {
    method: "POST",
    headers: { authorization: "Bearer operator:Owner:o1", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(consentDel.status, 501);
  assert.equal((await consentDel.json() as { action: string }).action, "trust.consent.hard_delete");

  const gdprDel = await a.request(`/admin/trust/gdpr/${id}/delete`, {
    method: "POST",
    headers: { authorization: "Bearer operator:Admin:a1", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(gdprDel.status, 501);
  assert.equal((await gdprDel.json() as { action: string }).action, "trust.gdpr.delete");

  assert.equal(audit.entries().length, 2);
  for (const e of audit.entries()) assert.deepEqual(e.after, { executed: false, reason: "not_implemented" });

  // A non-elevated role (Finance reads trust but cannot hard-delete consent) is 403, no audit.
  const audit2 = new InMemoryAuditSink();
  const a2 = createAdminApp({ db: throwingDb, verifier: testOperatorVerifier(), audit: audit2 });
  const denied = await a2.request(`/admin/trust/consent/${id}/delete`, {
    method: "POST",
    headers: { authorization: "Bearer operator:Finance:f1", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(denied.status, 403);
  assert.equal(audit2.entries().length, 0);
});

test("GET /admin/finance is the double-entry view with a display-only 70/30 accrual; Stripe TEST", async () => {
  const db = {
    async query(text: string) {
      if (/count\(\*\)::int as transactions/.test(text)) return { rows: [{ transactions: 3, credited: 1000, spent: 200, net: 800 }] };
      if (/group by type order by credited/.test(text)) return { rows: [{ type: "purchase", count: 2, credited: 1000, spent: 0 }] };
      if (/type = 'purchase'/.test(text)) return { rows: [{ gross: 1000 }] };
      return { rows: [] };
    },
  } as unknown as QueryPort;
  const res = await app(db).request("/admin/finance", { headers: { authorization: "Bearer operator:Finance:f1" } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    ledger: { net: number };
    payoutAccrual: { split: { creator: number; platform: number }; executed: boolean };
    billingMode: string;
  };
  assert.equal(body.ledger.net, 800);
  // 70/30 of 1000 gross.
  assert.equal(body.payoutAccrual.split.creator, 700);
  assert.equal(body.payoutAccrual.split.platform, 300);
  assert.equal(body.payoutAccrual.executed, false);
  assert.equal(body.billingMode, "stripe_test");
});

test("finance is read-broad: even ReadOnly can read it, but the payout-run is finance-gated", async () => {
  const ro = await app(probeEmptyDb).request("/admin/finance", { headers: { authorization: "Bearer operator:ReadOnly:r1" } });
  assert.equal(ro.status, 200);

  // Payout-run seam: Finance may reach it (501, no payout), ReadOnly is 403.
  const audit = new InMemoryAuditSink();
  const a = createAdminApp({ db: probeEmptyDb, verifier: testOperatorVerifier(), audit });
  const run = await a.request("/admin/finance/payouts/run", {
    method: "POST",
    headers: { authorization: "Bearer operator:Finance:f1", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(run.status, 501);
  assert.equal((await run.json() as { action: string }).action, "finance.payout.run");
  assert.equal(audit.entries().length, 1);
  assert.deepEqual(audit.entries()[0].after, { executed: false, reason: "not_implemented" });

  const denied = await a.request("/admin/finance/payouts/run", {
    method: "POST",
    headers: { authorization: "Bearer operator:ReadOnly:r1", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json() as { reason: string }).reason, "read_only_violation");
});

// ---- Section 16-17 (slice B): health + settings ----------------------------------------------------

test("GET /admin/health: Support is allowed and the registry never pings the live services", async () => {
  // The DB must NOT be touched: health is a static, ping-free registry.
  const res = await app().request("/admin/health", {
    headers: { authorization: "Bearer operator:Support:s1" },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { source: string; services: Array<{ id: string; status: string }> };
  assert.equal(body.source, "unwired");
  assert.ok(body.services.some((s) => s.id === "content" && s.status === "unknown"));
});

test("GET /admin/health: Content/Finance/Marketing/Moderation/ReadOnly are 403 (ops-scoped read)", async () => {
  for (const role of ["Content", "Finance", "Marketing", "Moderation", "ReadOnly"]) {
    const res = await app().request("/admin/health", {
      headers: { authorization: `Bearer operator:${role}:x` },
    });
    assert.equal(res.status, 403, `${role} should be denied health`);
    assert.equal((await res.json() as { reason: string }).reason, "role_forbidden");
  }
});

test("GET /admin/settings/audit: empty-unwired page when the table is unapplied (probe returns none)", async () => {
  const db = {
    async query(text: string) {
      // The catalog probe finds no table; the page/count selects must never be reached.
      if (/information_schema\.tables/.test(text)) return { rows: [] };
      throw new Error("page/count must not run when the audit table is unapplied");
    },
  } as unknown as QueryPort;
  const res = await app(db).request("/admin/settings/audit?limit=25&offset=0", {
    headers: { authorization: "Bearer operator:ReadOnly:r1" },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { rows: unknown[]; source: string; limit: number };
  assert.deepEqual(body.rows, []);
  assert.equal(body.source, "unwired");
  assert.equal(body.limit, 25);
});

test("GET /admin/settings/roles: read-broad, derived 8x route grid", async () => {
  const res = await app().request("/admin/settings/roles", {
    headers: { authorization: "Bearer operator:ReadOnly:r1" },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { source: string; roles: string[]; matrix: unknown[] };
  assert.equal(body.source, "derived");
  assert.equal(body.matrix.length, 8);
  assert.equal(body.roles.length, 8);
});

test("POST /admin/settings/flags/:key: Owner is a 501 audit seam; ReadOnly is 403", async () => {
  const audit = new InMemoryAuditSink();
  const a = createAdminApp({ db: throwingDb, verifier: testOperatorVerifier(), audit });

  const ok = await a.request("/admin/settings/flags/new_player", {
    method: "POST",
    headers: { authorization: "Bearer operator:Owner:o1", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(ok.status, 501);
  assert.equal((await ok.json() as { action: string }).action, "settings.flag.toggle");
  assert.equal(audit.entries().length, 1);
  assert.equal(audit.entries()[0].target, "flag:new_player");
  assert.deepEqual(audit.entries()[0].after, { executed: false, reason: "not_implemented" });

  const denied = await a.request("/admin/settings/flags/new_player", {
    method: "POST",
    headers: { authorization: "Bearer operator:ReadOnly:r1", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json() as { reason: string }).reason, "read_only_violation");
});
