// PROMPT 26 EPISODE pipeline: the real product. A premise (or explicit scene list) becomes a CONTINUOUS
// vertical episode, not loose clips. It expands the premise into N ~5s scene prompts, generates each shot
// (cost-metered, persisted to the attempt log), then STITCHES them into one continuous mp4 via the stitch
// client (Rendi concat). Returns a single episode URL. No em dashes.

import { produceConsistentShot, passRate, type ConsistencyScorer } from "./consistency.js";
import type { ConsentGate } from "./consentGate.js";
import type { ModelRegistry, ProviderClient, SubGenerationCache } from "./router.js";
import { scoreColumns, type EngineDb } from "./engineDb.js";
import type { StitchClient, SceneExpander } from "./providerClient.js";

export interface EpisodeRequest {
  specId: string;
  seriesId: string;
  style: string; // the style preamble prepended to every shot prompt
  scenes?: string[]; // explicit per-shot prompts; when absent, premise is expanded
  premise?: string;
  count?: number; // target shot count when expanding (default 12; ~60s at 5s/shot)
  durationS?: number; // per shot, default 5
  budgetUsd: number; // total episode budget
}

export interface EpisodeDeps {
  db: EngineDb;
  registry: ModelRegistry;
  client: ProviderClient;
  scorer: ConsistencyScorer;
  consent: ConsentGate;
  stitch: StitchClient;
  expand?: SceneExpander;
  cache?: SubGenerationCache;
}

export interface EpisodeShot {
  index: number;
  prompt: string;
  url: string | null;
}

export interface EpisodeResult {
  specId: string;
  episodeUrl: string | null; // the continuous stitched video (or the single shot when only one)
  shots: EpisodeShot[];
  shotCount: number; // accepted shots
  stitched: boolean;
  passRate: number;
  spentUsd: number;
  paused: boolean;
  error?: string;
}

export async function runEpisode(req: EpisodeRequest, deps: EpisodeDeps): Promise<EpisodeResult> {
  const durationS = req.durationS ?? 5;
  const count = req.count ?? 12;

  // 1. Resolve the scene list (explicit, or expanded from the premise).
  let scenes = req.scenes && req.scenes.length > 0 ? req.scenes : undefined;
  if (!scenes && req.premise && deps.expand) {
    scenes = await deps.expand.expand(req.premise, count, req.style);
  }
  if (!scenes || scenes.length === 0) {
    return { specId: req.specId, episodeUrl: null, shots: [], shotCount: 0, stitched: false, passRate: 0, spentUsd: 0, paused: false, error: "no_scenes" };
  }

  // 2. Generate each shot in order, metered against the total episode budget. Persist every attempt.
  const shots: EpisodeShot[] = [];
  const allAttempts: { passed: boolean }[] = [];
  let spentUsd = 0;
  let paused = false;
  for (let i = 0; i < scenes.length; i++) {
    const prompt = `${req.style} ${scenes[i]}`.trim();
    const res = await produceConsistentShot({
      brief: { modality: "video", durationS },
      params: { prompt },
      refs: {}, // no character lock yet: accept the first valid shot per scene
      registry: deps.registry,
      client: deps.client,
      scorer: deps.scorer,
      budget: { capUsd: req.budgetUsd, spentUsd },
      policy: { maxAttempts: 2 },
      cache: deps.cache,
    });
    spentUsd += res.spentUsd;
    for (const a of res.attempts) {
      allAttempts.push({ passed: a.pass });
      const attemptRow = await deps.db.insertAttempt({
        spec_id: req.specId,
        beat_id: null,
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
          thresholds: { faceCosineMin: 0.5, sceneScoreMin: 0.5 },
          passed: a.pass,
          reasons: a.pass ? [] : a.reason.split(",").filter(Boolean),
        });
      }
    }
    shots.push({ index: i, prompt: scenes[i], url: res.accepted?.outputUrl ?? null });
    if (res.paused) {
      paused = true;
      break; // budget exhausted: stitch what we have
    }
  }

  // 3. Stitch the accepted shots into one continuous episode.
  const urls = shots.map((s) => s.url).filter((u): u is string => !!u);
  let episodeUrl: string | null = null;
  let stitched = false;
  if (urls.length >= 2) {
    episodeUrl = await deps.stitch.stitch(urls);
    stitched = true;
  } else if (urls.length === 1) {
    episodeUrl = urls[0];
  }

  return {
    specId: req.specId,
    episodeUrl,
    shots,
    shotCount: urls.length,
    stitched,
    passRate: passRate(allAttempts.map((a, i) => ({ attempt: i, provider: "", modelHandle: "", modelId: "", outputUrl: null, score: null, pass: a.passed, reason: "", costUsd: 0, cached: false }))),
    spentUsd,
    paused,
  };
}
