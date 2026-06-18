// CORS acceptance for the ONLINE experiment serving tier. Boots the real node:http listener on an
// ephemeral port and asserts the permissive CORS contract the Vercel preview browsers need: an OPTIONS
// preflight is answered 204 with access-control-allow-origin:* and the permissive allow-methods/headers,
// and every routed response carries ACAO:*. Matches the identity/content services. No em dashes.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { startServer, buildDeps } from "./server.js";

describe("experiment online CORS", () => {
  let server: Server;
  let base: string;

  before(async () => {
    const started = await startServer(buildDeps(), 0, "127.0.0.1");
    server = started.server;
    base = `http://127.0.0.1:${started.port}`;
  });

  after(() => {
    server.close();
  });

  it("OPTIONS preflight returns 204 with permissive CORS headers", async () => {
    const res = await fetch(`${base}/assign`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const methods = res.headers.get("access-control-allow-methods") ?? "";
    for (const m of ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]) assert.ok(methods.includes(m), `methods include ${m}`);
    const allowHeaders = res.headers.get("access-control-allow-headers") ?? "";
    for (const h of ["content-type", "authorization", "accept"]) assert.ok(allowHeaders.includes(h), `allow-headers include ${h}`);
  });

  it("a routed GET /healthz carries access-control-allow-origin:*", async () => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });
});
