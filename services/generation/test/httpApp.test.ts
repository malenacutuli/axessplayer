// Prompt 26 HTTP app tests: healthz, reference enrollment, generate (pass / consent-block / cost-pause), and
// the attempt log + pass-rate. Drives the Hono app via app.fetch with the in-memory adapters. No em dashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGenerationApp, type GenerationAppDeps } from "../src/http/app.js";
import { testVerifiers } from "../src/http/auth.js";
import { InMemoryEngineDb } from "../src/engineDb.js";
import { FakeProviderClient, defaultRegistry, InMemorySubGenerationCache } from "../src/router.js";
import { ScriptedScorer, type ShotScore } from "../src/consistency.js";
import { InMemoryConsentGate } from "../src/consentGate.js";
import { makeLlmWritersRoom, type LlmCaller } from "../src/agents.js";

const TOKEN = "session:2a000000-0000-0000-0000-0000000000c0";
const SERIES = "11111111-1111-1111-1111-111111111111";

function makeApp(opts: { score?: ShotScore; consent?: InMemoryConsentGate; maxBudgetUsd?: number; agents?: boolean } = {}) {
  const db = new InMemoryEngineDb();
  const consent = opts.consent ?? new InMemoryConsentGate();
  // A silent LLM => the planning agents take their deterministic fallbacks (valid graph + evenly split shots).
  const silentLlm: LlmCaller = { async complete() { return ""; } };
  const deps: GenerationAppDeps = {
    db,
    registry: defaultRegistry(),
    client: new FakeProviderClient(1),
    scorer: new ScriptedScorer([opts.score ?? { faceCosine: 0.9, sceneScore: 0.9 }]),
    consent,
    verifiers: testVerifiers(),
    realBackend: false,
    allowRealSpend: false,
    maxBudgetUsd: opts.maxBudgetUsd ?? 25,
    source: "unwired",
    cache: new InMemorySubGenerationCache(),
    ...(opts.agents ? { llm: silentLlm, room: makeLlmWritersRoom(silentLlm, { beats: 6 }) } : {}),
  };
  return { app: createGenerationApp(deps), db, consent };
}

function req(app: ReturnType<typeof makeApp>["app"], method: string, path: string, body?: unknown, auth = TOKEN) {
  return app.fetch(
    new Request(`http://gen.test${path}`, {
      method,
      headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

const videoBrief = (over: Record<string, unknown> = {}) => ({ modality: "video", durationS: 5, ...over });

// POST /generate is async (202 + background run). Poll GET /generate/:specId until done/failed. Returns the
// final result body. Non-202 starts (400/401/403) are returned as { status, body } so callers assert directly.
async function generateAndWait(app: ReturnType<typeof makeApp>["app"], specId: string, payload: Record<string, unknown>) {
  const start = await req(app, "POST", "/generate", payload);
  if (start.status !== 202) return { startStatus: start.status, body: (await start.json()) as Record<string, unknown> };
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 5));
    const res = await req(app, "GET", `/generate/${specId}`);
    const body = (await res.json()) as Record<string, unknown>;
    if (body.status === "done" || body.status === "failed") return { startStatus: 202, body };
  }
  throw new Error("generation did not finish");
}

test("GET /healthz reports source + backend", async () => {
  const { app } = makeApp();
  const res = await req(app, "GET", "/healthz", undefined, "");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; source: string; realBackend: boolean };
  assert.equal(body.ok, true);
  assert.equal(body.realBackend, false);
});

test("auth is required for /generate and /references", async () => {
  const { app } = makeApp();
  assert.equal((await req(app, "POST", "/generate", {}, "")).status, 401);
  assert.equal((await req(app, "POST", "/references", {}, "")).status, 401);
});

test("enroll a reference, then generate -> accepted shot, attempts persisted with pass-rate", async () => {
  const { app } = makeApp();
  const enroll = await req(app, "POST", "/references", {
    seriesId: SERIES,
    ownerType: "character",
    ownerRef: "hero",
    kind: "face",
    embedding: [1, 0, 0, 0],
    model: "arcface-r100",
  });
  assert.equal(enroll.status, 201);

  const gen = await generateAndWait(app, "spec-1", {
    specId: "spec-1",
    seriesId: SERIES,
    tier: "C_ai",
    characterRef: "hero",
    brief: videoBrief({ shotCount: 4 }),
    params: { prompt: "hero walks in" },
  });
  assert.equal(gen.startStatus, 202);
  const body = gen.body as { accepted: unknown; passRate: number; paused: boolean };
  assert.ok(body.accepted, "a shot passed");
  assert.equal(body.paused, false);
  assert.equal(body.passRate, 1);

  const log = await req(app, "GET", "/attempts/spec-1");
  assert.equal(log.status, 200);
  const logBody = (await log.json()) as { attempts: unknown[]; passRate: number; count: number };
  assert.equal(logBody.count, 1);
  assert.equal(logBody.passRate, 1);
});

test("CONSENT GATE: a B_likeness generation without consent is blocked (403)", async () => {
  const { app } = makeApp();
  const res = await req(app, "POST", "/generate", {
    specId: "spec-blocked",
    seriesId: SERIES,
    tier: "B_likeness",
    brief: videoBrief(),
    params: {},
  });
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: string; reason: string };
  assert.equal(body.error, "consent_blocked");
});

test("CONSENT GATE: B_likeness with a current consent entry runs", async () => {
  const consent = new InMemoryConsentGate();
  consent.grant("consent-xyz");
  const { app } = makeApp({ consent });
  const gen = await generateAndWait(app, "spec-ok", {
    specId: "spec-ok",
    seriesId: SERIES,
    tier: "B_likeness",
    consentRef: "consent-xyz",
    realLikeness: true,
    brief: videoBrief(),
    params: {},
  });
  assert.equal(gen.startStatus, 202);
  assert.equal(gen.body.status, "done");
});

test("COST GATE: an over-budget run is paused before any spend", async () => {
  // Budget below the cheapest single shot, so the gate trips on the first attempt (no spend).
  const { app } = makeApp({ score: { faceCosine: 0.1, sceneScore: 0.1 }, maxBudgetUsd: 0.01 });
  await req(app, "POST", "/references", { seriesId: SERIES, ownerType: "character", ownerRef: "hero", kind: "face", embedding: [1, 0, 0, 0], model: "arcface" });
  const gen = await generateAndWait(app, "spec-budget", {
    specId: "spec-budget",
    seriesId: SERIES,
    tier: "C_ai",
    characterRef: "hero",
    brief: videoBrief(),
    params: {},
    policy: { maxAttempts: 5 },
    budgetUsd: 0.01,
  });
  assert.equal(gen.startStatus, 202);
  const body = gen.body as { paused: boolean; accepted: unknown };
  assert.equal(body.paused, true);
  assert.equal(body.accepted, null);
});

test("validation: bad tier / brief / spec are 400", async () => {
  const { app } = makeApp();
  assert.equal((await req(app, "POST", "/generate", { specId: "s", seriesId: SERIES, tier: "NOPE", brief: videoBrief() })).status, 400);
  assert.equal((await req(app, "POST", "/generate", { specId: "s", seriesId: SERIES, tier: "C_ai", brief: { modality: "video" } })).status, 400);
  assert.equal((await req(app, "POST", "/generate", { seriesId: SERIES, tier: "C_ai", brief: videoBrief() })).status, 400);
});

test("POST /script runs the showrunner planning agents into a valid script_json (no GPU)", async () => {
  const { app } = makeApp({ agents: true });
  const res = await req(app, "POST", "/script", { premise: "a heist in a sky city", targetS: 90 });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal((body.graph as { beats: unknown[] }).beats.length, 6);
  assert.equal((body.graphValid as { ok: boolean }).ok, true);
  assert.ok(Array.isArray(body.shots) && (body.shots as unknown[]).length >= 6);
  assert.ok((body.review as { runtimeS: number }).runtimeS > 0);
});

test("POST /script is 501 when the agents are not configured and 400 on an empty premise", async () => {
  assert.equal((await req(makeApp().app, "POST", "/script", { premise: "x" })).status, 501);
  assert.equal((await req(makeApp({ agents: true }).app, "POST", "/script", { premise: "  " })).status, 400);
  assert.equal((await req(makeApp({ agents: true }).app, "POST", "/script", {}, "")).status, 401);
});
