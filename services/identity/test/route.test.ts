// Route-level tests over the Hono app with in-memory fakes: exercises the C12 boundary (401
// sign_in_required), the Supabase token exchange (link/create + profile_complete), live username
// availability, profile create (validation, picks seeding), /me, and consent append. No Postgres.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createIdentityApp } from "../src/http/app.js";
import { testVerifiers } from "../src/http/auth.js";
import { InMemoryConsentSink } from "../src/consent.js";
import type { IdentityDb, ProfileRow, ProfileUpdate } from "../src/identityDb.js";

const SUBJECT_UUID = "11111111-1111-1111-1111-111111111111";

// A minimal in-memory IdentityDb fake. Keys profiles by id; tracks follows and seeded vectors.
class FakeDb implements IdentityDb {
  rows = new Map<string, ProfileRow>();
  follows: Array<{ userId: string; channelId: string }> = [];
  vectors: Array<{ userId: string; seriesId: string; vector: Record<string, number> }> = [];
  takenUsernames = new Set<string>();

  seed(p: ProfileRow): void {
    this.rows.set(p.id, p);
    if (p.username) this.takenUsernames.add(p.username.toLowerCase());
  }

  async linkOrCreateByAuthId(authId: string, email: string): Promise<ProfileRow> {
    for (const p of this.rows.values()) if (p.authId === authId) return p;
    const row: ProfileRow = {
      id: SUBJECT_UUID,
      email,
      authId,
      username: null,
      avatarUrl: null,
      tier: null,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async usernameAvailable(normalizedUsername: string, excludeUserId?: string): Promise<boolean> {
    for (const p of this.rows.values()) {
      if (excludeUserId != null && p.id === excludeUserId) continue;
      if (p.username && p.username.toLowerCase() === normalizedUsername) return false;
    }
    return !this.takenUsernames.has(normalizedUsername);
  }

  async findById(userId: string): Promise<ProfileRow | null> {
    return this.rows.get(userId) ?? null;
  }

  async updateProfile(userId: string, update: ProfileUpdate): Promise<ProfileRow> {
    const cur = this.rows.get(userId);
    if (cur == null) throw new Error("unknown_user");
    const next: ProfileRow = { ...cur, username: update.username, avatarUrl: update.avatarUrl };
    this.rows.set(userId, next);
    return next;
  }

  async seedPreferenceVector(
    userId: string,
    seriesId: string,
    vector: Record<string, number>,
  ): Promise<void> {
    this.vectors.push({ userId, seriesId, vector });
  }

  async followChannel(userId: string, channelId: string): Promise<void> {
    this.follows.push({ userId, channelId });
  }
}

function makeApp(db: IdentityDb): { app: ReturnType<typeof createIdentityApp>; consent: InMemoryConsentSink } {
  const consent = new InMemoryConsentSink();
  const app = createIdentityApp({ db, consent, verifiers: testVerifiers() });
  return { app, consent };
}

const sessionHeader = { authorization: `Bearer session:${SUBJECT_UUID}` };

test("POST /auth/verify links/creates and reports incomplete profile", async () => {
  const db = new FakeDb();
  const { app } = makeApp(db);
  const res = await app.fetch(
    new Request("http://id.local/auth/verify", {
      method: "POST",
      headers: { authorization: "Bearer supabase:auth-abc:user@example.com" },
    }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { email: string }; profile_complete: boolean };
  assert.equal(body.user.email, "user@example.com");
  assert.equal(body.profile_complete, false);
});

test("POST /auth/verify rejects a bad token with 401 invalid_token", async () => {
  const { app } = makeApp(new FakeDb());
  const res = await app.fetch(
    new Request("http://id.local/auth/verify", {
      method: "POST",
      headers: { authorization: "Bearer garbage" },
    }),
  );
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "invalid_token" });
});

test("C12: protected route without a session returns 401 sign_in_required", async () => {
  const { app } = makeApp(new FakeDb());
  for (const [method, path] of [
    ["GET", "/me"],
    ["POST", "/profile"],
    ["POST", "/consent"],
  ] as const) {
    const res = await app.fetch(new Request(`http://id.local${path}`, { method }));
    assert.equal(res.status, 401, `${method} ${path}`);
    assert.deepEqual(await res.json(), { error: "sign_in_required" }, `${method} ${path}`);
  }
});

test("GET /profile/username-available is anonymous and case-insensitive", async () => {
  const db = new FakeDb();
  db.takenUsernames.add("taken");
  const { app } = makeApp(db);

  const free = await app.fetch(new Request("http://id.local/profile/username-available?u=Fresh"));
  assert.equal(free.status, 200);
  assert.deepEqual(await free.json(), { available: true });

  const taken = await app.fetch(new Request("http://id.local/profile/username-available?u=TAKEN"));
  assert.deepEqual(await taken.json(), { available: false });

  const bad = await app.fetch(new Request("http://id.local/profile/username-available?u=_bad"));
  assert.deepEqual(await bad.json(), { available: false, reason: "invalid_chars" });
});

test("POST /profile validates, persists, seeds picks into follows + vector", async () => {
  const db = new FakeDb();
  db.seed({
    id: SUBJECT_UUID,
    email: "user@example.com",
    authId: "auth-abc",
    username: null,
    avatarUrl: null,
    tier: null,
  });
  const { app } = makeApp(db);
  const res = await app.fetch(
    new Request("http://id.local/profile", {
      method: "POST",
      headers: { ...sessionHeader, "content-type": "application/json" },
      body: JSON.stringify({
        username: "Malena",
        avatar_url: "https://cdn/x.png",
        series_id: "22222222-2222-2222-2222-222222222222",
        picks: ["telenovela", { channelId: "crime" }, "telenovela"],
      }),
    }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { username: string }; profile_complete: boolean };
  assert.equal(body.user.username, "malena");
  assert.equal(body.profile_complete, true);
  // Picks deduped to two follows; vector seeded once with neutral weights.
  assert.deepEqual(db.follows.map((f) => f.channelId).sort(), ["crime", "telenovela"]);
  assert.equal(db.vectors.length, 1);
  assert.deepEqual(db.vectors[0].vector, { telenovela: 1, crime: 1 });
});

test("POST /profile rejects a malformed username with 400", async () => {
  const db = new FakeDb();
  db.seed({ id: SUBJECT_UUID, email: "u@e.com", authId: "a", username: null, avatarUrl: null, tier: null });
  const { app } = makeApp(db);
  const res = await app.fetch(
    new Request("http://id.local/profile", {
      method: "POST",
      headers: { ...sessionHeader, "content-type": "application/json" },
      body: JSON.stringify({ username: "ab" }),
    }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; reason: string };
  assert.equal(body.error, "invalid_username");
  assert.equal(body.reason, "too_short");
});

test("POST /profile returns 409 when the handle is taken by another user", async () => {
  const db = new FakeDb();
  db.seed({ id: SUBJECT_UUID, email: "u@e.com", authId: "a", username: null, avatarUrl: null, tier: null });
  db.seed({
    id: "99999999-9999-9999-9999-999999999999",
    email: "other@e.com",
    authId: "b",
    username: "taken",
    avatarUrl: null,
    tier: null,
  });
  const { app } = makeApp(db);
  const res = await app.fetch(
    new Request("http://id.local/profile", {
      method: "POST",
      headers: { ...sessionHeader, "content-type": "application/json" },
      body: JSON.stringify({ username: "taken" }),
    }),
  );
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "username_taken" });
});

test("GET /me returns the session subject's profile", async () => {
  const db = new FakeDb();
  db.seed({
    id: SUBJECT_UUID,
    email: "u@e.com",
    authId: "a",
    username: "malena",
    avatarUrl: null,
    tier: "free",
  });
  const { app } = makeApp(db);
  const res = await app.fetch(new Request("http://id.local/me", { headers: sessionHeader }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { user: { id: string }; profile_complete: boolean };
  assert.equal(body.user.id, SUBJECT_UUID);
  assert.equal(body.profile_complete, true);
});

test("POST /consent appends a record and returns a receipt", async () => {
  const db = new FakeDb();
  db.seed({ id: SUBJECT_UUID, email: "u@e.com", authId: "a", username: "malena", avatarUrl: null, tier: null });
  const { app, consent } = makeApp(db);
  const res = await app.fetch(
    new Request("http://id.local/consent", {
      method: "POST",
      headers: { ...sessionHeader, "content-type": "application/json" },
      body: JSON.stringify({ purpose: "data_capture", policy_version: "2026-06-01", granted: true }),
    }),
  );
  assert.equal(res.status, 201);
  const body = (await res.json()) as { consent_ref: string; granted: boolean };
  assert.ok(body.consent_ref.startsWith("consent-stub:"));
  assert.equal(body.granted, true);
  assert.equal(consent.all().length, 1);
  assert.equal(consent.all()[0].userId, SUBJECT_UUID);
  assert.equal(consent.all()[0].purpose, "data_capture");
});

test("POST /consent rejects missing purpose/policy with 400", async () => {
  const db = new FakeDb();
  db.seed({ id: SUBJECT_UUID, email: "u@e.com", authId: "a", username: "malena", avatarUrl: null, tier: null });
  const { app } = makeApp(db);
  const res = await app.fetch(
    new Request("http://id.local/consent", {
      method: "POST",
      headers: { ...sessionHeader, "content-type": "application/json" },
      body: JSON.stringify({ granted: true }),
    }),
  );
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "invalid_request" });
});
