// HTTP-surface acceptance for the engagement events collector. Boots the real node:http listener on an
// ephemeral port and asserts the two properties the Render 502 fix and the Vercel cross-origin call
// depend on:
//   1. BOOT RESILIENCE: the server constructs and binds WITHOUT a database, and GET /healthz returns 200
//      without ever touching pg. A lazy SQL provider that throws (database unreachable) does NOT crash the
//      process; it degrades the write path to 503 while /healthz stays green.
//   2. CORS: an OPTIONS preflight is answered 204 with access-control-allow-origin:* and the
//      permissive allow-methods/allow-headers, matching the identity/content services, and every response
//      carries ACAO:*.
// No real database, no em dashes.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createEventsServer, type SqlProvider } from "../src/server.js";
import type { SqlClient } from "../src/collector.js";

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

describe("events node:http surface boots without a database", () => {
  let server: Server;
  let base: string;

  before(async () => {
    // A lazy provider that ALWAYS throws stands in for an unreachable database at boot. The server must
    // still construct, bind, and serve /healthz; only the write path degrades.
    const unreachable: SqlProvider = () => {
      throw new Error("connect ECONNREFUSED (simulated)");
    };
    server = createEventsServer(unreachable);
    base = await listen(server);
  });

  after(() => {
    server.close();
  });

  it("GET /healthz returns 200 without needing the DB", async () => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
  });

  it("GET /healthz?probe=1 still matches (query string stripped)", async () => {
    const res = await fetch(`${base}/healthz?probe=1`);
    assert.equal(res.status, 200);
  });

  it("POST /events degrades to 503 (not a crash) when the DB is unreachable", async () => {
    const res = await fetch(`${base}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [] }),
    });
    assert.equal(res.status, 503);
    // The process is still alive: a follow-up health check still answers.
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
  });

  it("OPTIONS preflight returns 204 with permissive CORS headers", async () => {
    const res = await fetch(`${base}/events`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const methods = res.headers.get("access-control-allow-methods") ?? "";
    for (const m of ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]) assert.ok(methods.includes(m), `methods include ${m}`);
    const allowHeaders = res.headers.get("access-control-allow-headers") ?? "";
    for (const h of ["content-type", "authorization", "accept"]) assert.ok(allowHeaders.includes(h), `allow-headers include ${h}`);
  });

  it("every response carries access-control-allow-origin:*", async () => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });
});

describe("events node:http surface persists when the DB is reachable", () => {
  let server: Server;
  let base: string;
  const calls: { text: string; params: unknown[] }[] = [];

  before(async () => {
    const fake: SqlClient = {
      async query(text: string, params?: unknown[]) {
        calls.push({ text, params: params ?? [] });
        return { rows: [] };
      },
    };
    // Eager-client form (not a provider) must still be accepted.
    server = createEventsServer(fake);
    base = await listen(server);
  });

  after(() => {
    server.close();
  });

  it("POST /events with a valid batch returns 200 and writes through", async () => {
    const res = await fetch(`${base}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        events: [
          { event_id: "e1", session_id: "s1", type: "beat_started" },
        ],
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { accepted: number };
    assert.equal(body.accepted, 1);
    assert.equal(calls.length, 1);
  });
});
