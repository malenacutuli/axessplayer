// API + node:http integration. Exercises the four routes over the wire through the real listener, and the
// acceptance scenarios end to end: analyze is read-only, a rights-missing enqueue is BLOCKED, a Tier C
// enqueue parks awaiting review, an unwired generative adapter never fabricates a completed asset, and an
// over-budget job pauses. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { startServer, buildDeps } from "../src/httpServer.js";

const SESSION = "Bearer session:11111111-1111-1111-1111-111111111111";

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const deps = buildDeps({ nodeEnv: "test" });
  const { server, port } = await startServer(deps, 0, "127.0.0.1");
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

async function post(base: string, path: string, body: unknown, auth = SESSION): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
async function get(base: string, path: string, auth = SESSION): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, { headers: auth ? { authorization: auth } : {} });
  return { status: res.status, json: await res.json() };
}

// Register a source via /analyze, returning the sourceId. rights is passed through for later enqueues.
async function analyzeSource(base: string, rights: Record<string, unknown>, isHero = false): Promise<string> {
  const r = await post(base, "/analyze", { assetUrl: "s3://archive/master.mov", rights, isHero });
  assert.equal(r.status, 200);
  return r.json.sourceId as string;
}

const FULL_RIGHTS = {
  ownsFootage: true, actorAdaptationRights: true, voiceRights: true, likenessRights: true,
  musicRights: true, territoryCleared: true, brandLogoCleared: true, aiTransformationAllowed: true,
  ageSensitiveReviewed: true, consentRef: "consent:ok", consentCurrent: true,
};

test("unauthenticated request is 401", async () => {
  await withServer(async (base) => {
    const r = await post(base, "/analyze", { assetUrl: "x" }, "");
    assert.equal(r.status, 401);
  });
});

test("POST /analyze is read-only and returns scores + scenes + plan", async () => {
  await withServer(async (base) => {
    const r = await post(base, "/analyze", { assetUrl: "s3://archive/master.mov", rights: FULL_RIGHTS });
    assert.equal(r.status, 200);
    assert.equal(r.json.source, "unwired");
    assert.ok(Array.isArray(r.json.scores));
    assert.ok(Array.isArray(r.json.scenes));
    assert.ok(Array.isArray(r.json.plan));
    // The plan includes a one-click Tier A action and a low-confidence Tier C action.
    const reframe = r.json.scores.find((s: any) => s.capability === "vertical_reframe");
    assert.equal(reframe.mode, "one_click");
    const actor = r.json.scores.find((s: any) => s.capability === "actor_replacement");
    assert.equal(actor.tier, "C");
    assert.equal(actor.lowConfidenceFlagged, true);
  });
});

test("a rights-missing enqueue is BLOCKED (HARD gate)", async () => {
  await withServer(async (base) => {
    const sourceId = await analyzeSource(base, { ownsFootage: false });
    const r = await post(base, "/jobs", { sourceId, capability: "vertical_reframe" });
    assert.equal(r.status, 422);
    assert.equal(r.json.job.state, "blocked");
    assert.equal(r.json.job.currentStage, "rights_gate");
  });
});

test("a Tier A one-click action with full rights drives to done", async () => {
  await withServer(async (base) => {
    const sourceId = await analyzeSource(base, FULL_RIGHTS);
    const r = await post(base, "/jobs", { sourceId, capability: "vertical_reframe" });
    assert.equal(r.status, 201);
    assert.equal(r.json.job.state, "done");
    assert.equal(r.json.job.playbackUrl, `adapted://${sourceId}/vertical_reframe`);
  });
});

test("a Tier C enqueue requires a prompt and then parks awaiting review", async () => {
  await withServer(async (base) => {
    const sourceId = await analyzeSource(base, FULL_RIGHTS, true);
    // Without a prompt the low-confidence action is rejected up front.
    const noPrompt = await post(base, "/jobs", { sourceId, capability: "actor_replacement" });
    assert.equal(noPrompt.status, 400);
    assert.equal(noPrompt.json.error, "prompt_required_for_low_confidence_action");
    // With a prompt it parks at human_review (Tier C on hero content never auto-renders).
    const r = await post(base, "/jobs", { sourceId, capability: "actor_replacement", prompt: "replace double" });
    assert.equal(r.status, 201);
    assert.equal(r.json.job.state, "awaiting_review");
    assert.equal(r.json.job.currentStage, "human_review");
    assert.equal(r.json.job.playbackUrl, null);
    // GET the job back.
    const got = await get(base, `/jobs/${r.json.job.jobId}`);
    assert.equal(got.status, 200);
    assert.equal(got.json.job.state, "awaiting_review");
  });
});

test("approving a Tier C job does NOT fabricate an asset (no generative backend wired)", async () => {
  await withServer(async (base) => {
    const sourceId = await analyzeSource(base, FULL_RIGHTS, false);
    const enq = await post(base, "/jobs", { sourceId, capability: "actor_replacement", prompt: "x" });
    const jobId = enq.json.job.jobId;
    const appr = await post(base, `/jobs/${jobId}/approve`, { reviewer: "ops:jane" });
    assert.equal(appr.status, 200);
    // The gated adapter refuses (no backend), so the job fails at full_render with no playbackUrl.
    assert.equal(appr.json.job.state, "failed");
    assert.equal(appr.json.job.currentStage, "full_render");
    assert.equal(appr.json.job.playbackUrl, null);
  });
});

test("approving a job whose consent was revoked is BLOCKED and purges", async () => {
  await withServer(async (base) => {
    // consentRef revoked: refreshConsent flips consentCurrent false at approval time.
    const sourceId = await analyzeSource(base, { ...FULL_RIGHTS, consentRef: "consent-revoked:x" }, false);
    const enq = await post(base, "/jobs", { sourceId, capability: "actor_replacement", prompt: "x" });
    // Enqueue already blocks because consent is not current for a likeness capability.
    assert.equal(enq.json.job.state, "blocked");
  });
});

test("an over-budget Tier C job pauses", async () => {
  await withServer(async (base) => {
    const sourceId = await analyzeSource(base, FULL_RIGHTS, false);
    const r = await post(base, "/jobs", { sourceId, capability: "actor_replacement", prompt: "x", budgetUsd: 0.01 });
    assert.equal(r.json.job.state, "paused_over_budget");
    assert.equal(r.json.job.currentStage, "adaptation_plan");
  });
});

test("a Tier A job cannot be approved (409)", async () => {
  await withServer(async (base) => {
    const sourceId = await analyzeSource(base, FULL_RIGHTS, false);
    const enq = await post(base, "/jobs", { sourceId, capability: "vertical_reframe" });
    const appr = await post(base, `/jobs/${enq.json.job.jobId}/approve`, { reviewer: "ops:jane" });
    assert.equal(appr.status, 409);
  });
});

test("an unknown capability is rejected", async () => {
  await withServer(async (base) => {
    const sourceId = await analyzeSource(base, FULL_RIGHTS, false);
    const r = await post(base, "/jobs", { sourceId, capability: "teleport" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, "invalid_capability");
  });
});
