// SLICE B acceptance for the node:http bridge + cutover gate. Boots the real listener on an ephemeral port
// (host 127.0.0.1 for the test) and exercises the JOB API CONTRACT over the wire; verifies the
// NODE_ENV=production hard stop on the test verifier. No real money or media. No em dashes.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { startServer, buildDeps, selectVerifier } from "./httpServer.js";

const USER = "22222222-2222-2222-2222-222222222222";
const AUTH = `Bearer session:${USER}`;
const SERIES = "11111111-1111-1111-1111-111111111111";

describe("ingestion node:http bridge (JOB API CONTRACT over the wire)", () => {
  let server: Server;
  let base: string;

  before(async () => {
    const deps = buildDeps({ nodeEnv: "test" });
    const started = await startServer(deps, 0, "127.0.0.1");
    server = started.server;
    base = `http://127.0.0.1:${started.port}`;
  });

  after(() => {
    server.close();
  });

  it("GET /jobs returns an empty list with source unwired", async () => {
    const res = await fetch(`${base}/jobs`, { headers: { authorization: AUTH } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { jobs: unknown[]; source: string };
    assert.deepEqual(body.jobs, []);
    assert.equal(body.source, "unwired");
  });

  it("POST /produce returns the plan + estimate, then GET /jobs/:id reads it back", async () => {
    const res = await fetch(`${base}/produce`, {
      method: "POST",
      headers: { authorization: AUTH, "content-type": "application/json" },
      body: JSON.stringify({
        seriesId: SERIES,
        targets: { languages: ["en", "es"], tracks: { cc: true, ad: true }, signLanguages: ["ASL"], costTier: "hero" },
        beats: 2,
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { jobId: string; estimatedUsd: number };
    assert.ok(body.jobId.startsWith("prod_"));
    assert.ok(body.estimatedUsd > 0);

    const got = await fetch(`${base}/jobs/${encodeURIComponent(body.jobId)}`, { headers: { authorization: AUTH } });
    assert.equal(got.status, 200);
    const gjson = (await got.json()) as { job: { jobId: string } };
    assert.equal(gjson.job.jobId, body.jobId);
  });

  it("a missing/invalid session is 401", async () => {
    const res = await fetch(`${base}/jobs`);
    assert.equal(res.status, 401);
  });

  it("a malformed JSON body on /produce is a clean 400, not a 500", async () => {
    const res = await fetch(`${base}/produce`, {
      method: "POST",
      headers: { authorization: AUTH, "content-type": "application/json" },
      body: "{ not json",
    });
    assert.equal(res.status, 400);
  });
});

describe("cutover gate", () => {
  it("selectVerifier refuses the test verifier under NODE_ENV=production", () => {
    assert.throws(() => selectVerifier({ nodeEnv: "production" }), /cutover gate/);
  });
  it("selectVerifier returns the test verifier outside production", () => {
    assert.ok(selectVerifier({ nodeEnv: "test" }));
  });
});
