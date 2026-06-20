// PROMPT 26 orchestration: runGeneration ties the router + consistency QA loop + consent gate + cost gate to
// PERSISTENCE. It loads the enrolled references for the character/scene, runs the consent gate, runs the
// reject/retry loop, and writes every attempt to generation_attempts + every score to qa_scores (the IP
// flywheel + the QA pass-rate the admin media factory surfaces). The HTTP handler is a thin shell over this.
// No em dashes.

import type { VariantTier } from "./spec.js";
import type { CostBudget } from "./finops.js";
import {
  produceConsistentShot,
  passRate,
  DEFAULT_THRESHOLDS,
  type ConsistencyScorer,
  type ConsistencyThresholds,
  type GenerationAttempt,
  type ReferenceSet,
  type RetryPolicy,
} from "./consistency.js";
import {
  guardLikenessConsent,
  ConsentBlockedError,
  type ConsentGate,
} from "./consentGate.js";
import type {
  GenerationBrief,
  ModelRegistry,
  NormalizedOutput,
  ProviderClient,
  SubGenerationCache,
} from "./router.js";
import { scoreColumns, type EngineDb } from "./engineDb.js";

export interface GenerateRequest {
  specId: string; // idempotency key for the attempt log
  seriesId: string;
  beatId?: string | null;
  tier: VariantTier;
  consentRef?: string | null;
  realLikeness?: boolean;
  characterRef?: string | null; // owner_ref for face references (the character lock)
  sceneRef?: string | null; // owner_ref for scene references
  brief: GenerationBrief;
  params: Record<string, unknown>;
  budget: CostBudget;
  thresholds?: ConsistencyThresholds;
  policy?: RetryPolicy;
}

export interface GenerateDeps {
  db: EngineDb;
  registry: ModelRegistry;
  client: ProviderClient;
  scorer: ConsistencyScorer;
  consent: ConsentGate;
  cache?: SubGenerationCache;
}

export interface GenerateResult {
  specId: string;
  accepted: NormalizedOutput | null;
  attempts: GenerationAttempt[];
  passRate: number;
  paused: boolean;
  pauseReason?: string;
  spentUsd: number;
  blocked?: { reason: string }; // set when the consent gate refused the run
}

// Build the ReferenceSet for a request from the enrolled embeddings (first scorable embedding per kind).
async function loadReferences(db: EngineDb, req: GenerateRequest): Promise<ReferenceSet> {
  const refs: ReferenceSet = {};
  if (req.characterRef) {
    const rows = await db.getReferenceEmbeddings(req.seriesId, "character", req.characterRef);
    const face = rows.find((r) => r.kind === "face" && r.embedding && r.embedding.length > 0);
    if (face?.embedding) refs.face = face.embedding;
  }
  if (req.sceneRef) {
    const rows = await db.getReferenceEmbeddings(req.seriesId, "scene", req.sceneRef);
    const scene = rows.find((r) => r.kind === "scene" && r.embedding && r.embedding.length > 0);
    if (scene?.embedding) refs.scene = scene.embedding;
  }
  return refs;
}

export async function runGeneration(req: GenerateRequest, deps: GenerateDeps): Promise<GenerateResult> {
  // HARD GATE 1: consent. A likeness generation without a current consent entry never runs (no spend).
  try {
    await guardLikenessConsent(deps.consent, req.tier, req.consentRef, req.realLikeness ?? false);
  } catch (e) {
    if (e instanceof ConsentBlockedError) {
      return { specId: req.specId, accepted: null, attempts: [], passRate: 0, paused: false, spentUsd: 0, blocked: { reason: e.reason } };
    }
    throw e;
  }

  const refs = await loadReferences(deps.db, req);
  const thresholds = req.thresholds ?? DEFAULT_THRESHOLDS;

  // The consistency QA + auto-retry loop (cost gate is metered inside it).
  const result = await produceConsistentShot({
    brief: req.brief,
    params: req.params,
    refs,
    registry: deps.registry,
    client: deps.client,
    scorer: deps.scorer,
    budget: req.budget,
    thresholds,
    policy: req.policy,
    cache: deps.cache,
  });

  // Persist every attempt (the dataset) + every score (the QA pass-rate).
  for (const a of result.attempts) {
    const attemptRow = await deps.db.insertAttempt({
      spec_id: req.specId,
      beat_id: req.beatId ?? null,
      attempt: a.attempt,
      provider: a.provider,
      model_handle: a.modelHandle,
      model_id: a.modelId,
      output_url: a.outputUrl,
      passed: a.pass,
      reason: a.reason,
      cost_usd: a.costUsd,
      cached: a.cached,
      state: a.reason.startsWith("paused_over_budget") ? "paused_over_budget" : "done",
    });
    if (a.score) {
      const cols = scoreColumns(a.score);
      await deps.db.insertQaScore({
        generation_attempt_id: attemptRow.id,
        beat_variant_id: null,
        face_cosine: cols.face_cosine,
        scene_score: cols.scene_score,
        thresholds: thresholds as unknown as Record<string, unknown>,
        passed: a.pass,
        reasons: a.pass ? [] : a.reason.split(",").filter(Boolean),
      });
    }
  }

  return {
    specId: req.specId,
    accepted: result.accepted,
    attempts: result.attempts,
    passRate: result.passRate,
    paused: result.paused,
    pauseReason: result.pauseReason,
    spentUsd: result.spentUsd,
  };
}

// Pass-rate over a persisted attempt set (for GET /attempts/:specId).
export function attemptsPassRate(attempts: ReadonlyArray<{ passed: boolean }>): number {
  if (attempts.length === 0) return 0;
  return attempts.filter((a) => a.passed).length / attempts.length;
}
