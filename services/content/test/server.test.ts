// Tests for the served HTTP entry point (src/server.ts). These start the REAL node:http server on an
// ephemeral port bound to 0.0.0.0 and issue a real network request, proving the wire is listening on all
// interfaces (the container-reachable binding) and the app is reachable over a real socket. The asserted
// route (GET /series/<malformed>/graph -> 404) is answered by the handler's uuid guard BEFORE any DB
// access, so no Postgres is needed: the stub db throws if ever touched, which would surface as a 500, not
// the documented 404. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type pg from "pg";

import { buildContentApp, startServer } from "../src/server.js";

// A pool stub whose query throws: the documented 404 path (malformed uuid) must never reach it.
const throwingPool = {
  query() {
    throw new Error("db must not be touched on the malformed-id 404 path");
  },
} as unknown as pg.Pool;

async function withServer(fn: (base: string, server: Server) => Promise<void>): Promise<void> {
  const app = buildContentApp(throwingPool);
  const { server, port } = await startServer(app, 0, "0.0.0.0");
  try {
    await fn(`http://127.0.0.1:${port}`, server);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

test("content served entry: binds 0.0.0.0 on an ephemeral port", async () => {
  await withServer(async (_base, server) => {
    const addr = server.address() as AddressInfo;
    assert.equal(addr.address, "0.0.0.0", "listener must bind all interfaces for container reachability");
    assert.ok(addr.port > 0, "expected a bound ephemeral port");
  });
});

test("content served entry: real GET of a malformed series id returns the documented 404 over a socket", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/series/not-a-uuid/graph`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "series_not_found");
  });
});
