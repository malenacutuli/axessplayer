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
import { runGeneration, attemptsPassRate, type GenerateRequest } from "../engine.js";
import type { EngineDb } from "../engineDb.js";
import type { ConsistencyScorer, ConsistencyThresholds, RetryPolicy } from "../consistency.js";
import type { ConsentGate } from "../consentGate.js";
import type { GenerationBrief, ModelRegistry, ProviderClient, SubGenerationCache } from "../router.js";
import { VARIANT_TIERS, type VariantTier } from "../spec.js";

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

    const result = await runGeneration(req, {
      db: deps.db,
      registry: deps.registry,
      client: deps.client,
      scorer: deps.scorer,
      consent: deps.consent,
      cache: deps.cache,
    });

    if (result.blocked) {
      return c.json({ error: "consent_blocked", reason: result.blocked.reason, specId: result.specId }, 403);
    }
    return c.json(result, 200);
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
