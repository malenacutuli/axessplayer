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
