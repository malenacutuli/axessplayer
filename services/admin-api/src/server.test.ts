// Tests for the served HTTP entry (src/server.ts). Start the REAL node:http server on an ephemeral port
// bound to 0.0.0.0 and issue a real network request, proving the wire listens on all interfaces (the
// container-reachable binding) and the app answers over a real socket. The asserted route (GET /admin/me
// with no auth -> 401) is answered at the operator-auth edge BEFORE any DB access, so no Postgres is
// needed: the stub pool throws if ever touched, surfacing as a 500 not the documented 401. Also asserts
// the production cutover gate. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type pg from "pg";

import { selectVerifier, buildAdminApp, startServer, type AdminServerConfig } from "./server.js";
import { InMemoryAuditSink } from "./audit.js";

const throwingPool = {
  query() {
    throw new Error("db must not be touched on the unauthenticated 401 path");
  },
} as unknown as pg.Pool;

const devCfg: AdminServerConfig = { databaseUrl: "postgres://unused", nodeEnv: "test" };
// The served-entry tests run the local test operator verifier, which now needs an explicit opt-in.
process.env.ADMIN_ALLOW_TEST_OPERATORS = "1";

async function withServer(fn: (base: string, server: Server) => Promise<void>): Promise<void> {
  const app = buildAdminApp(throwingPool, devCfg, new InMemoryAuditSink());
  const { server, port } = await startServer(app, 0, "0.0.0.0");
  try {
    await fn(`http://127.0.0.1:${port}`, server);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test("admin-api served entry: binds 0.0.0.0 on an ephemeral port", async () => {
  await withServer(async (_base, server) => {
    const addr = server.address() as AddressInfo;
    assert.equal(addr.address, "0.0.0.0", "listener must bind all interfaces for container reachability");
    assert.ok(addr.port > 0, "expected a bound ephemeral port");
  });
});

test("admin-api served entry: real GET /admin/me with no auth returns 401 over a socket", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/admin/me`);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "unauthorized");
  });
});

test("admin-api served entry: a valid operator token reaches GET /admin/me over a socket", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/admin/me`, { headers: { authorization: "Bearer operator:Admin:a1" } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { operator: "a1", role: "Admin" });
  });
});

test("admin-api: without an explicit local opt-in, every operator token is refused (no forged operators)", async () => {
  for (const nodeEnv of ["production", "staging", undefined]) {
    const v = selectVerifier({ ...devCfg, nodeEnv } as never, {});
    assert.equal(await v.verify("operator:Admin:attacker"), null);
  }
  const local = selectVerifier({ ...devCfg, nodeEnv: "development" } as never, { ADMIN_ALLOW_TEST_OPERATORS: "1" });
  assert.notEqual(await local.verify("operator:Admin:a1"), null);
  assert.equal(await selectVerifier({ ...devCfg, nodeEnv: "production" } as never, { ADMIN_ALLOW_TEST_OPERATORS: "1" }).verify("operator:Admin:x"), null);
});
