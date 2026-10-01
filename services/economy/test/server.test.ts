// Tests for the served HTTP entry point (src/server.ts). Unlike http.test.ts (which exercises the Hono app
// in process), these start the REAL node:http server on an ephemeral port bound to 0.0.0.0 and issue a real
// network request, proving the wire is listening on all interfaces (the container-reachable binding) and
// the app is reachable over a real socket. The asserted route (GET /wallet with no auth -> 401) is answered
// at the auth edge BEFORE any DB access, so no Postgres is needed: the stub db throws if ever touched, which
// would surface as a 500, not the documented 401. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type pg from "pg";

import { buildEconomyApp, startServer } from "../src/server.js";
import type { EconomyServerConfig } from "../src/server.js";

// A pool stub whose query throws: the documented 401 path must never reach it.
const throwingPool = {
  query() {
    throw new Error("db must not be touched on the unauthenticated 401 path");
  },
} as unknown as pg.Pool;

// Non-production config so the entrypoint wires the TEST verifiers (the documented dev default).
const devCfg: EconomyServerConfig = {
  databaseUrl: "postgres://unused",
  nodeEnv: "test",
  serviceSecret: "test-secret",
};

async function withServer(fn: (base: string, server: Server) => Promise<void>): Promise<void> {
  const app = buildEconomyApp(throwingPool, devCfg);
  const { server, port } = await startServer(app, 0, "0.0.0.0");
  try {
    await fn(`http://127.0.0.1:${port}`, server);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

test("economy served entry: binds 0.0.0.0 on an ephemeral port", async () => {
  await withServer(async (_base, server) => {
    const addr = server.address() as AddressInfo;
    assert.equal(addr.address, "0.0.0.0", "listener must bind all interfaces for container reachability");
    assert.ok(addr.port > 0, "expected a bound ephemeral port");
  });
});

test("economy served entry: real GET /wallet with no auth returns the documented 401 over a socket", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/wallet`);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "unauthorized");
  });
});

test("economy served entry: NODE_ENV=production without Supabase config stays up but authenticates no one", async () => {
  const app = buildEconomyApp(throwingPool, { ...devCfg, nodeEnv: "production", serviceSecret: "s" });
  const res = await app.request("/wallet", {
    method: "GET",
    headers: { authorization: "Bearer session:2a000000-0000-0000-0000-0000000000c0", "content-type": "application/json" },
    
  });
  assert.equal(res.status, 401);
});

test("economy served entry: GET /healthz answers 200 without touching the database", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, service: "economy" });
  });
});
