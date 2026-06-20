// HTTP adapter for the generation engine (prompt 26). A thin Hono app over runGeneration + the EngineDb port.
// Endpoints:
//   GET  /healthz                  liveness + whether real backends are wired.
//   POST /references               enroll a reference embedding (the consistency scorer compares against it).
//   POST /generate                 run a brief through the router + consistency QA + consent + cost gate,
//                                  persist every attempt + score, return the result + the QA pass-rate.
//   GET  /attempts/:specId         the attempt log + pass-rate for a spec (the admin media factory reads this).
//
// All policy (routing, scoring, retry, gates) lives below this layer; the handler only does auth, parse, and
// map { result } to a response. The cost gate refuses a REAL backend run unless GENERATION_ALLOW_REAL_SPEND
// is open, mirroring backends.ts. No em dashes.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { parseBearer, type Verifiers } from "./auth.js";
import { runGeneration, attemptsPassRate, type GenerateRequest, type GenerateResult } from "../engine.js";
import { runEpisode, type EpisodeResult } from "../episode.js";
import type { EngineDb } from "../engineDb.js";
import type { ConsistencyScorer, ConsistencyThresholds, RetryPolicy } from "../consistency.js";
import { guardLikenessConsent, ConsentBlockedError, type ConsentGate } from "../consentGate.js";
import type { GenerationBrief, ModelRegistry, ProviderClient, SubGenerationCache } from "../router.js";
import type { StitchClient, SceneExpander } from "../providerClient.js";
import { VARIANT_TIERS, type VariantTier } from "../spec.js";

// Real video generation takes 60-120s, too long for one synchronous HTTP request through a proxy. POST
// /generate kicks the run in the background and returns immediately; GET /generate/:specId polls the result.
type JobState =
  | { status: "running" }
  | { status: "done"; result: GenerateResult }
  | { status: "failed"; error: string };

type EpisodeJobState =
  | { status: "running" }
  | { status: "done"; result: EpisodeResult }
  | { status: "failed"; error: string };

export interface GenerationAppDeps {
  db: EngineDb;
  registry: ModelRegistry;
  client: ProviderClient;
  scorer: ConsistencyScorer;
  consent: ConsentGate;
  verifiers: Verifiers;
  // Whether the wired ProviderClient incurs real cost (a real vendor). When true, /generate is refused unless
  // allowRealSpend is open.
  realBackend: boolean;
  allowRealSpend: boolean; // GENERATION_ALLOW_REAL_SPEND=1
  maxBudgetUsd: number; // hard ceiling on a single run's budget
  source: "wired" | "unwired"; // surfaced on /healthz
  cache?: SubGenerationCache;
  // Episode pipeline: stitch N shots into one continuous video; expand a premise into scene prompts.
  stitch?: StitchClient;
  expand?: SceneExpander;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseBrief(v: unknown): GenerationBrief | null {
  if (!isObject(v)) return null;
  const modality = v.modality;
  if (modality !== "video" && modality !== "image" && modality !== "voice" && modality !== "lipsync") return null;
  if (typeof v.durationS !== "number" || !(v.durationS > 0)) return null;
  const brief: GenerationBrief = { modality, durationS: v.durationS };
  if (typeof v.shotCount === "number") brief.shotCount = v.shotCount;
  if (Array.isArray(v.needs)) brief.needs = v.needs.filter((x): x is string => typeof x === "string");
  if (typeof v.preview === "boolean") brief.preview = v.preview;
  if (typeof v.providerHint === "string") brief.providerHint = v.providerHint;
  return brief;
}

export function createGenerationApp(deps: GenerationAppDeps): Hono {
  const app = new Hono();
  app.use(
    "*",
    cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["content-type", "authorization", "accept"] }),
  );
  const { db, verifiers } = deps;
  // In-memory job store for async generation (single-instance QA; lost on restart, which is acceptable since
  // the attempt log is persisted to Postgres regardless).
  const jobs = new Map<string, JobState>();
  const episodeJobs = new Map<string, EpisodeJobState>();

  const auth = async (authorization: string | undefined) =>
    verifiers.session.verifySession(parseBearer(authorization));

  app.get("/healthz", (c) => c.json({ ok: true, service: "generation", source: deps.source, realBackend: deps.realBackend }, 200));

  // POST /references : enroll a reference embedding for a character (face) or scene.
  app.post("/references", async (c) => {
    if ((await auth(c.req.header("authorization"))) == null) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json().catch(() => null);
    if (!isObject(body)) return c.json({ error: "invalid_body" }, 400);
    const { seriesId, ownerType, ownerRef, kind, embedding, model, dim } = body;
    if (typeof seriesId !== "string") return c.json({ error: "invalid_series_id" }, 400);
    if (ownerType !== "character" && ownerType !== "scene") return c.json({ error: "invalid_owner_type" }, 400);
    if (typeof ownerRef !== "string" || ownerRef.length === 0) return c.json({ error: "invalid_owner_ref" }, 400);
    if (kind !== "face" && kind !== "scene") return c.json({ error: "invalid_kind" }, 400);
    if (typeof model !== "string" || model.length === 0) return c.json({ error: "invalid_model" }, 400);
    const vector = Array.isArray(embedding) ? embedding.map((x) => Number(x)) : null;
    const row = await db.insertReferenceEmbedding({
      series_id: seriesId,
      owner_type: ownerType,
      owner_ref: ownerRef,
      kind,
      embedding: vector,
      model,
      dim: typeof dim === "number" ? dim : vector?.length ?? null,
    });
    return c.json(row, 201);
  });

  // POST /generate : run a generation brief through the full engine.
  app.post("/generate", async (c) => {
    if ((await auth(c.req.header("authorization"))) == null) return c.json({ error: "unauthorized" }, 401);

    // Cost gate: a real-cost backend may only run when the human gate is open.
    if (deps.realBackend && !deps.allowRealSpend) {
      return c.json({ error: "cost_gate_closed", detail: "set GENERATION_ALLOW_REAL_SPEND=1 after a cost sign-off" }, 403);
    }

    const body = await c.req.json().catch(() => null);
    if (!isObject(body)) return c.json({ error: "invalid_body" }, 400);
    if (typeof body.specId !== "string" || body.specId.length === 0) return c.json({ error: "invalid_spec_id" }, 400);
    if (typeof body.seriesId !== "string") return c.json({ error: "invalid_series_id" }, 400);
    const tier = body.tier;
    if (typeof tier !== "string" || !VARIANT_TIERS.includes(tier as VariantTier)) return c.json({ error: "invalid_tier" }, 400);
    const brief = parseBrief(body.brief);
    if (brief == null) return c.json({ error: "invalid_brief" }, 400);

    const requestedBudget = typeof body.budgetUsd === "number" && body.budgetUsd > 0 ? body.budgetUsd : deps.maxBudgetUsd;
    const capUsd = Math.min(requestedBudget, deps.maxBudgetUsd);

    const req: GenerateRequest = {
      specId: body.specId,
      seriesId: body.seriesId,
      beatId: typeof body.beatId === "string" ? body.beatId : null,
      tier: tier as VariantTier,
      consentRef: typeof body.consentRef === "string" ? body.consentRef : null,
      realLikeness: body.realLikeness === true,
      characterRef: typeof body.characterRef === "string" ? body.characterRef : null,
      sceneRef: typeof body.sceneRef === "string" ? body.sceneRef : null,
      brief,
      params: isObject(body.params) ? body.params : {},
      budget: { capUsd, spentUsd: 0 },
      thresholds: isObject(body.thresholds) ? (body.thresholds as unknown as ConsistencyThresholds) : undefined,
      policy: isObject(body.policy) ? (body.policy as unknown as RetryPolicy) : undefined,
    };

    // Consent gate runs SYNCHRONOUSLY so a blocked likeness fails fast with a 403 (no background work).
    try {
      await guardLikenessConsent(deps.consent, req.tier, req.consentRef, req.realLikeness ?? false);
    } catch (e) {
      if (e instanceof ConsentBlockedError) return c.json({ error: "consent_blocked", reason: e.reason, specId: req.specId }, 403);
      throw e;
    }

    // Kick the (long-running) generation in the background and return immediately. The client polls
    // GET /generate/:specId. The attempt log is persisted to Postgres by runGeneration regardless.
    jobs.set(req.specId, { status: "running" });
    void runGeneration(req, {
      db: deps.db,
      registry: deps.registry,
      client: deps.client,
      scorer: deps.scorer,
      consent: deps.consent,
      cache: deps.cache,
    })
      .then((result) => jobs.set(req.specId, { status: "done", result }))
      .catch((err) => jobs.set(req.specId, { status: "failed", error: err instanceof Error ? err.message : String(err) }));

    return c.json({ specId: req.specId, status: "running" }, 202);
  });

  // GET /generate/:specId : poll the result of an async generation run.
  app.get("/generate/:specId", async (c) => {
    if ((await auth(c.req.header("authorization"))) == null) return c.json({ error: "unauthorized" }, 401);
    const specId = c.req.param("specId");
    const job = jobs.get(specId);
    if (job == null) return c.json({ specId, status: "unknown" }, 404);
    if (job.status === "done") return c.json({ ...job.result, status: "done" }, 200);
    if (job.status === "failed") return c.json({ specId, status: "failed", error: job.error }, 200);
    return c.json({ specId, status: "running" }, 200);
  });

  // POST /episode : generate a CONTINUOUS episode (premise or scenes -> N shots -> stitched into one video).
  // Async like /generate: returns 202, poll GET /episode/:specId.
  app.post("/episode", async (c) => {
    if ((await auth(c.req.header("authorization"))) == null) return c.json({ error: "unauthorized" }, 401);
    if (deps.realBackend && !deps.allowRealSpend) return c.json({ error: "cost_gate_closed" }, 403);
    if (!deps.stitch) return c.json({ error: "stitch_not_configured" }, 501);
    const body = await c.req.json().catch(() => null);
    if (!isObject(body)) return c.json({ error: "invalid_body" }, 400);
    if (typeof body.specId !== "string" || body.specId.length === 0) return c.json({ error: "invalid_spec_id" }, 400);
    if (typeof body.seriesId !== "string") return c.json({ error: "invalid_series_id" }, 400);
    const scenes = Array.isArray(body.scenes) ? body.scenes.filter((s): s is string => typeof s === "string") : undefined;
    const premise = typeof body.premise === "string" ? body.premise : undefined;
    if ((!scenes || scenes.length === 0) && !premise) return c.json({ error: "need scenes or premise" }, 400);
    const requestedBudget = typeof body.budgetUsd === "number" && body.budgetUsd > 0 ? body.budgetUsd : deps.maxBudgetUsd;
    const capUsd = Math.min(requestedBudget, deps.maxBudgetUsd);

    episodeJobs.set(body.specId, { status: "running" });
    void runEpisode(
      {
        specId: body.specId,
        seriesId: body.seriesId,
        style: typeof body.style === "string" ? body.style : "",
        scenes,
        premise,
        count: typeof body.count === "number" ? body.count : undefined,
        durationS: typeof body.durationS === "number" ? body.durationS : undefined,
        budgetUsd: capUsd,
      },
      { db: deps.db, registry: deps.registry, client: deps.client, scorer: deps.scorer, consent: deps.consent, stitch: deps.stitch, expand: deps.expand, cache: deps.cache },
    )
      .then((result) => episodeJobs.set(body.specId as string, { status: "done", result }))
      .catch((err) => episodeJobs.set(body.specId as string, { status: "failed", error: err instanceof Error ? err.message : String(err) }));

    return c.json({ specId: body.specId, status: "running" }, 202);
  });

  // GET /episode/:specId : poll an async episode build.
  app.get("/episode/:specId", async (c) => {
    if ((await auth(c.req.header("authorization"))) == null) return c.json({ error: "unauthorized" }, 401);
    const specId = c.req.param("specId");
    const job = episodeJobs.get(specId);
    if (job == null) return c.json({ specId, status: "unknown" }, 404);
    if (job.status === "done") return c.json({ ...job.result, status: "done" }, 200);
    if (job.status === "failed") return c.json({ specId, status: "failed", error: job.error }, 200);
    return c.json({ specId, status: "running" }, 200);
  });

  // GET /attempts/:specId : the attempt log + QA pass-rate for a spec.
  app.get("/attempts/:specId", async (c) => {
    if ((await auth(c.req.header("authorization"))) == null) return c.json({ error: "unauthorized" }, 401);
    const specId = c.req.param("specId");
    const attempts = await db.listAttempts(specId);
    return c.json({ specId, attempts, passRate: attemptsPassRate(attempts), count: attempts.length }, 200);
  });

  return app;
}
