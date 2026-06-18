// CORS acceptance for the ingestion service. Boots the real node:http listener on an ephemeral port
// (NODE_ENV unset so the test verifier is allowed) and asserts the permissive CORS contract the Vercel
// preview browsers need: an OPTIONS preflight is answered 204 with access-control-allow-origin:* and the
// permissive allow-methods/headers, and every routed response carries ACAO:*. Matches identity/content.
// No em dashes.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { startServer, buildDeps } from "./httpServer.js";

const USER = "22222222-2222-2222-2222-222222222222";
const AUTH = `Bearer session:${USER}`;

describe("ingestion CORS", () => {
  let server: Server;
  let base: string;

  before(async () => {
    const started = await startServer(buildDeps({ nodeEnv: "test" }), 0, "127.0.0.1");
    server = started.server;
    base = `http://127.0.0.1:${started.port}`;
  });

  after(() => {
    server.close();
  });

  it("OPTIONS preflight returns 204 with permissive CORS headers", async () => {
    const res = await fetch(`${base}/jobs`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const methods = res.headers.get("access-control-allow-methods") ?? "";
    for (const m of ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]) assert.ok(methods.includes(m), `methods include ${m}`);
    const allowHeaders = res.headers.get("access-control-allow-headers") ?? "";
    for (const h of ["content-type", "authorization", "accept"]) assert.ok(allowHeaders.includes(h), `allow-headers include ${h}`);
  });

  it("a routed GET /jobs carries access-control-allow-origin:*", async () => {
    const res = await fetch(`${base}/jobs`, { headers: { authorization: AUTH } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });
});
