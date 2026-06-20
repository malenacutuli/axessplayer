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

const TOKEN = "session:2a000000-0000-0000-0000-0000000000c0";
const SERIES = "11111111-1111-1111-1111-111111111111";

function makeApp(opts: { score?: ShotScore; consent?: InMemoryConsentGate; maxBudgetUsd?: number } = {}) {
  const db = new InMemoryEngineDb();
  const consent = opts.consent ?? new InMemoryConsentGate();
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

  const gen = await req(app, "POST", "/generate", {
    specId: "spec-1",
    seriesId: SERIES,
    tier: "C_ai",
    characterRef: "hero",
    brief: videoBrief({ shotCount: 4 }),
    params: { prompt: "hero walks in" },
  });
  assert.equal(gen.status, 200);
  const body = (await gen.json()) as { accepted: unknown; passRate: number; paused: boolean; attempts: unknown[] };
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
  const res = await req(app, "POST", "/generate", {
    specId: "spec-ok",
    seriesId: SERIES,
    tier: "B_likeness",
    consentRef: "consent-xyz",
    realLikeness: true,
    brief: videoBrief(),
    params: {},
  });
  assert.equal(res.status, 200);
});

test("COST GATE: a tiny budget pauses the run including its retries", async () => {
  // Each attempt estimates 0.05*5 = 0.25 on the cheapest final model; budget 0.3 affords one attempt only.
  const { app } = makeApp({ score: { faceCosine: 0.1, sceneScore: 0.1 }, maxBudgetUsd: 0.3 });
  const res = await req(app, "POST", "/generate", {
    specId: "spec-budget",
    seriesId: SERIES,
    tier: "C_ai",
    brief: videoBrief(),
    params: {},
    policy: { maxAttempts: 5 },
    budgetUsd: 0.3,
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { paused: boolean; accepted: unknown; spentUsd: number };
  assert.equal(body.paused, true);
  assert.equal(body.accepted, null);
});

test("validation: bad tier / brief / spec are 400", async () => {
  const { app } = makeApp();
  assert.equal((await req(app, "POST", "/generate", { specId: "s", seriesId: SERIES, tier: "NOPE", brief: videoBrief() })).status, 400);
  assert.equal((await req(app, "POST", "/generate", { specId: "s", seriesId: SERIES, tier: "C_ai", brief: { modality: "video" } })).status, 400);
  assert.equal((await req(app, "POST", "/generate", { seriesId: SERIES, tier: "C_ai", brief: videoBrief() })).status, 400);
});
