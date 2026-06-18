// SLICE B acceptance for the JOB API CONTRACT handlers (POST /produce, GET /jobs, GET /jobs/:id). Pure
// handlers over the unwired store + test session verifier: auth is enforced from the bearer token (not the
// body), /produce returns {jobId, plan, estimatedUsd} as a cost-before-commit preview, /jobs is empty with
// source:"unwired", and /jobs/:id reads back the just-created job. No real money or media. No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handle, testSessionVerifier, parseBearer, type ApiDeps, type ApiRequest } from "./jobApi.js";
import { UnwiredJobsStore } from "./jobsStore.js";

const USER = "22222222-2222-2222-2222-222222222222";
const AUTH = `Bearer session:${USER}`;
const SERIES = "11111111-1111-1111-1111-111111111111";

function deps(): ApiDeps {
  return { store: new UnwiredJobsStore(), verifier: testSessionVerifier() };
}

function req(over: Partial<ApiRequest>): ApiRequest {
  return { method: "GET", path: "/jobs", authorization: AUTH, body: undefined, ...over };
}

const produceBody = {
  seriesId: SERIES,
  episodeId: null,
  beats: 1,
  targets: { languages: ["en", "es"], tracks: { cc: true, ad: true, sign: true, dub: true }, signLanguages: ["ASL"], costTier: "hero" },
};

describe("auth at the trust boundary", () => {
  it("parseBearer extracts the token, null on absent/malformed", () => {
    assert.equal(parseBearer("Bearer session:x"), "session:x");
    assert.equal(parseBearer("session:x"), null);
    assert.equal(parseBearer(null), null);
  });

  it("GET /jobs without a valid session is 401", async () => {
    const r = await handle(req({ authorization: null }), deps());
    assert.equal(r.status, 401);
  });

  it("POST /produce without a valid session is 401 (identity not from body)", async () => {
    const r = await handle(req({ method: "POST", path: "/produce", authorization: "Bearer nope", body: produceBody }), deps());
    assert.equal(r.status, 401);
  });
});

describe("POST /produce", () => {
  it("returns jobId + plan + estimatedUsd (cost-before-commit) and source unwired", async () => {
    const r = await handle(req({ method: "POST", path: "/produce", body: produceBody }), deps());
    assert.equal(r.status, 200);
    const b = r.body as Record<string, unknown>;
    assert.ok(typeof b.jobId === "string" && (b.jobId as string).startsWith("prod_"));
    assert.ok(b.plan != null);
    assert.ok(typeof b.estimatedUsd === "number" && (b.estimatedUsd as number) > 0);
    assert.equal(b.state, "queued");
    assert.equal(b.source, "unwired");
  });

  it("rejects a missing series id and a body with no languages", async () => {
    const noSeries = await handle(req({ method: "POST", path: "/produce", body: { targets: { languages: ["en"] } } }), deps());
    assert.equal(noSeries.status, 400);
    const noLangs = await handle(req({ method: "POST", path: "/produce", body: { seriesId: SERIES, targets: { languages: [] } } }), deps());
    assert.equal(noLangs.status, 400);
  });

  it("wrong method on /produce is 405", async () => {
    const r = await handle(req({ method: "GET", path: "/produce" }), deps());
    assert.equal(r.status, 405);
  });
});

describe("GET /jobs and GET /jobs/:id", () => {
  it("GET /jobs is an empty list with source unwired", async () => {
    const r = await handle(req({ path: "/jobs" }), deps());
    assert.equal(r.status, 200);
    const b = r.body as { jobs: unknown[]; source: string };
    assert.deepEqual(b.jobs, []);
    assert.equal(b.source, "unwired");
  });

  it("a job created via POST is readable by GET /jobs/:id within the process", async () => {
    const d = deps();
    const created = await handle(req({ method: "POST", path: "/produce", body: produceBody }), d);
    const jobId = (created.body as Record<string, unknown>).jobId as string;
    const got = await handle(req({ path: `/jobs/${jobId}` }), d);
    assert.equal(got.status, 200);
    const b = got.body as { job: { jobId: string; stages: unknown[] }; source: string };
    assert.equal(b.job.jobId, jobId);
    assert.ok(b.job.stages.length > 0);
    assert.equal(b.source, "unwired");
  });

  it("an unknown job id is 404", async () => {
    const r = await handle(req({ path: "/jobs/does-not-exist" }), deps());
    assert.equal(r.status, 404);
  });

  it("an unknown route is 404 and a healthcheck is open", async () => {
    assert.equal((await handle(req({ path: "/whatever" }), deps())).status, 404);
    const h = await handle(req({ path: "/health", authorization: null }), deps());
    assert.equal(h.status, 200);
  });
});
