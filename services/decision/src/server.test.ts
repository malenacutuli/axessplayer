// Tests for the served HTTP entry point (src/server.ts). These start the REAL node:http server on an
// ephemeral port bound to 0.0.0.0 and issue a real network request, proving the wire is listening on all
// interfaces (the container-reachable binding) and the app is reachable over a real socket. The asserted
// route (POST /decide with no auth -> 401) is answered at the session-auth edge BEFORE any engine/DB
// access, so no Postgres is needed: the stub db throws if ever touched, which would surface as a 500, not
// the documented 401. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type pg from "pg";

import { buildDecisionApp, startServer } from "./server.js";
import type { DecisionServerConfig } from "./server.js";

// A pool stub whose query throws: the documented 401 path must never reach the engine or DB.
const throwingPool = {
  query() {
    throw new Error("db must not be touched on the unauthenticated 401 path");
  },
} as unknown as pg.Pool;

const devCfg: DecisionServerConfig = { databaseUrl: "postgres://unused", nodeEnv: "test" };

async function withServer(fn: (base: string, server: Server) => Promise<void>): Promise<void> {
  const app = buildDecisionApp(throwingPool, devCfg);
  const { server, port } = await startServer(app, 0, "0.0.0.0");
  try {
    await fn(`http://127.0.0.1:${port}`, server);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

test("decision served entry: binds 0.0.0.0 on an ephemeral port", async () => {
  await withServer(async (_base, server) => {
    const addr = server.address() as AddressInfo;
    assert.equal(addr.address, "0.0.0.0", "listener must bind all interfaces for container reachability");
    assert.ok(addr.port > 0, "expected a bound ephemeral port");
  });
});

test("decision served entry: real POST /decide with an invalid token returns the documented 401 over a socket", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer forged" },
      body: JSON.stringify({ current_beat_id: "x", signals: {} }),
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "unauthorized");
  });
});

test("decision served entry: NODE_ENV=production without Supabase config stays up but authenticates no one", async () => {
  const app = buildDecisionApp(throwingPool, { ...devCfg, nodeEnv: "production" });
  const res = await app.request("/decide", {
    method: "POST",
    headers: { authorization: "Bearer session:2a000000-0000-0000-0000-0000000000c0", "content-type": "application/json" },
    body: JSON.stringify({ current_beat_id: 'x', signals: {} }),
  });
  assert.equal(res.status, 401);
});
