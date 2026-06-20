// PROMPT 26 / GOLD_STANDARD_16: the CONSISTENCY QA + AUTO-RETRY loop. This is the real moat and the second
// data flywheel. Every generated shot is scored on face cosine (vs an enrolled character reference) and a
// scene score (vs an enrolled scene reference); a shot below a TUNED threshold is auto-rejected and
// regenerated (switch provider and/or re-anchor on the last good frame); every attempt is logged pass/fail,
// and that labeled dataset + the tuned policy is the defensible IP.
//
// HARD TRUTHS baked in:
//   - Thresholds are NOT universal: they are config, tuned per model/population empirically (published
//     face-cosine cutoffs range ~0.30 strict to ~0.7 conservative). DEFAULTS here are FLAGGED placeholders.
//   - Long video = chaining 5-15s segments via first-last-frame continuation, never one-pass multi-minute.
//   - The cost gate meters EVERY attempt including retries; a retry that would exceed budget PAUSES the run.
//   - A cache hit (identical sub-generation) costs nothing, so retries do not pay twice.
//
// The scorer is an injected port (real impl calls InsightFace/ArcFace + a video-text model via edge
// functions; the fake is deterministic for tests), the same inversion the router and cost gate use.
// No em dashes.

import {
  chooseModel,
  runModel,
  type GenerationBrief,
  type ModelRegistry,
  type NormalizedOutput,
  type ProviderClient,
  type SubGenerationCache,
} from "./router.js";
import { authorizeSpend, type CostBudget } from "./finops.js";

// ---------- scoring ----------

// Cosine similarity of two equal-length vectors, in [-1, 1]. Returns null for unscorable inputs (empty or
// mismatched length) so a missing embedding degrades to "unscorable", never a false pass.
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return null;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// The enrolled references a shot is scored against. face = a 512-dim ArcFace-class character embedding;
// scene = a video-text scene embedding. Either may be absent (then that dimension is unscorable).
export interface ReferenceSet {
  face?: readonly number[];
  scene?: readonly number[];
}

export interface ShotScore {
  faceCosine: number | null;
  sceneScore: number | null;
}

// Tuned thresholds. NOT UNIVERSAL: tune per model/population on the accumulated pass/fail dataset. These
// defaults are FLAGGED placeholders for the dry run, intentionally mid-range.
export interface ConsistencyThresholds {
  faceCosineMin: number;
  sceneScoreMin: number;
}
export const DEFAULT_THRESHOLDS: ConsistencyThresholds = { faceCosineMin: 0.5, sceneScoreMin: 0.5 };

// The verdict for one shot. A dimension that is unscorable (null) does not fail the shot on its own, but a
// shot with NO scorable dimension is rejected (we never pass an unverifiable shot).
export interface ShotVerdict {
  pass: boolean;
  reasons: string[];
}

export function evaluateShot(score: ShotScore, thresholds: ConsistencyThresholds): ShotVerdict {
  const reasons: string[] = [];
  let scoredAny = false;
  if (score.faceCosine != null) {
    scoredAny = true;
    if (score.faceCosine < thresholds.faceCosineMin) reasons.push("face_below_threshold");
  }
  if (score.sceneScore != null) {
    scoredAny = true;
    if (score.sceneScore < thresholds.sceneScoreMin) reasons.push("scene_below_threshold");
  }
  if (!scoredAny) reasons.push("unscorable");
  return { pass: reasons.length === 0, reasons };
}

// The scorer port. The real impl embeds the produced shot (face + scene) and compares to the references;
// the fake returns deterministic scores for tests.
export interface ConsistencyScorer {
  scoreShot(outputUrl: string, refs: ReferenceSet): Promise<ShotScore>;
}

// ---------- the attempt log (the labeled dataset) ----------

export interface GenerationAttempt {
  attempt: number; // 1-based
  provider: string;
  modelHandle: string; // our registry id
  modelId: string; // the vendor model id
  outputUrl: string | null;
  score: ShotScore | null;
  pass: boolean;
  reason: string; // "ok" when passed; the failing checks (or "paused_over_budget") otherwise
  costUsd: number; // what this attempt actually cost (0 on a cache hit or a paused attempt)
  cached: boolean;
}

// Pass-rate over a set of attempts (surfaced in the admin media factory). 0 when there are no attempts.
export function passRate(attempts: readonly GenerationAttempt[]): number {
  if (attempts.length === 0) return 0;
  return attempts.filter((a) => a.pass).length / attempts.length;
}

// ---------- the reject/retry loop ----------

export interface RetryPolicy {
  maxAttempts: number; // total attempts including the first
  // Providers to rotate through on failure (the "switch provider" lever). The first is used first; on each
  // rejection the next is tried, wrapping around. Empty = stay on the router's default pick.
  providerOrder?: string[];
  // Re-anchor the next attempt on the previous attempt's frame (first-last-frame re-seed). The anchor is
  // passed to the provider as params.anchorUrl.
  reanchorOnFail?: boolean;
}

export interface ProduceConsistentInput {
  brief: GenerationBrief; // modality video; the router picks the model
  params: Record<string, unknown>; // base provider params (prompt, etc.); anchorUrl is injected on re-anchor
  refs: ReferenceSet;
  registry: ModelRegistry;
  client: ProviderClient;
  scorer: ConsistencyScorer;
  budget: CostBudget; // metered across ALL attempts including retries
  thresholds?: ConsistencyThresholds;
  policy?: RetryPolicy;
  cache?: SubGenerationCache;
}

export interface ProduceConsistentResult {
  accepted: NormalizedOutput | null; // the first shot that passed, or null
  attempts: GenerationAttempt[];
  passRate: number;
  paused: boolean; // true when the cost gate stopped the run before exhausting attempts
  pauseReason?: string;
  spentUsd: number;
}

// Generate one consistency-checked shot with auto-retry. Produce -> score -> if below threshold, reject and
// regenerate (switch provider per providerOrder, optionally re-anchor on the last frame) until a shot passes
// or attempts/budget are exhausted. Every attempt is metered against the budget (a retry that would exceed
// it pauses the run) and logged pass/fail.
export async function produceConsistentShot(input: ProduceConsistentInput): Promise<ProduceConsistentResult> {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const policy = input.policy ?? { maxAttempts: 3 };
  const providerOrder = policy.providerOrder ?? [];
  const attempts: GenerationAttempt[] = [];
  let spentUsd = 0;
  let anchorUrl: string | undefined = typeof input.params.anchorUrl === "string" ? input.params.anchorUrl : undefined;
  // Consistency QA needs a reference to hold against. With no enrolled face/scene (a fresh text-to-video with
  // no character lock), there is nothing to reject on, so the first produced shot is accepted. The QA loop
  // still meters cost + retries on provider errors. Enroll a reference to turn the consistency gate on.
  const noRefs = !(input.refs.face && input.refs.face.length > 0) && !(input.refs.scene && input.refs.scene.length > 0);

  for (let i = 0; i < policy.maxAttempts; i++) {
    const providerHint = providerOrder.length > 0 ? providerOrder[i % providerOrder.length] : input.brief.providerHint;
    const decision = chooseModel({ ...input.brief, providerHint }, input.registry);
    const estimate = decision.estimatedUsd;

    // COST GATE: authorize this attempt against the budget already spent in this run. A retry that would
    // exceed the cap pauses the run rather than overspending.
    const auth = authorizeSpend({ capUsd: input.budget.capUsd, spentUsd: input.budget.spentUsd + spentUsd }, estimate);
    if (!auth.allowed) {
      attempts.push({
        attempt: i + 1,
        provider: decision.model.provider,
        modelHandle: decision.model.id,
        modelId: decision.model.model_id,
        outputUrl: null,
        score: null,
        pass: false,
        reason: `paused_over_budget:${auth.reason ?? "over budget"}`,
        costUsd: 0,
        cached: false,
      });
      return { accepted: null, attempts, passRate: passRate(attempts), paused: true, pauseReason: auth.reason, spentUsd };
    }

    const params = anchorUrl != null ? { ...input.params, anchorUrl } : input.params;
    const out = await runModel({ model: decision.model, params }, { client: input.client, cache: input.cache });
    const cost = out.cached ? 0 : estimate;
    spentUsd += cost;

    let score: ShotScore | null = null;
    let verdict: ShotVerdict;
    if (noRefs) {
      verdict = { pass: true, reasons: [] };
    } else {
      score = await input.scorer.scoreShot(out.outputUrl, input.refs);
      verdict = evaluateShot(score, thresholds);
    }
    attempts.push({
      attempt: i + 1,
      provider: out.provider,
      modelHandle: out.modelHandle,
      modelId: out.model_id,
      outputUrl: out.outputUrl,
      score,
      pass: verdict.pass,
      reason: verdict.pass ? (noRefs ? "no_reference_lock" : "ok") : verdict.reasons.join(","),
      costUsd: cost,
      cached: out.cached,
    });

    if (verdict.pass) {
      return { accepted: out, attempts, passRate: passRate(attempts), paused: false, spentUsd };
    }
    // Rejected: re-anchor the next attempt on this frame if the policy asks (first-last-frame re-seed).
    if (policy.reanchorOnFail) anchorUrl = out.outputUrl;
  }

  return { accepted: null, attempts, passRate: passRate(attempts), paused: false, spentUsd };
}

// ---------- long video = chaining (first-last-frame) ----------

export interface ChainSegment {
  brief: GenerationBrief;
  params: Record<string, unknown>;
}

export interface ChainResult {
  segments: ProduceConsistentResult[];
  held: boolean; // true only when EVERY segment produced an accepted shot above threshold
  totalSpentUsd: number;
  overallPassRate: number;
}

// Chain N segments into a longer sequence: each segment is consistency-checked, and the NEXT segment is
// anchored on the accepted last frame of the previous one (FLF continuation). The character "holds" only if
// every segment passes. Stops at the first segment that cannot pass (or pauses on budget).
export async function chainSegments(
  segments: readonly ChainSegment[],
  shared: Omit<ProduceConsistentInput, "brief" | "params">,
): Promise<ChainResult> {
  const results: ProduceConsistentResult[] = [];
  let anchorUrl: string | undefined;
  let totalSpentUsd = 0;
  let held = true;

  for (const seg of segments) {
    const params = anchorUrl != null ? { ...seg.params, anchorUrl } : seg.params;
    const res = await produceConsistentShot({ ...shared, brief: seg.brief, params });
    results.push(res);
    totalSpentUsd += res.spentUsd;
    if (!res.accepted) {
      held = false;
      break; // a chain cannot continue past a segment that failed to lock
    }
    anchorUrl = res.accepted.outputUrl; // FLF: next segment continues from this frame
  }

  const allAttempts = results.flatMap((r) => r.attempts);
  return { segments: results, held, totalSpentUsd, overallPassRate: passRate(allAttempts) };
}

// ---------- fakes for tests / dry run ----------

// A deterministic scorer driven by a script of scores (one per call), so a test can express "fail, then
// pass". When the script runs out, it repeats the last entry. Unscriptable dimensions pass through as the
// provided defaults.
export class ScriptedScorer implements ConsistencyScorer {
  private idx = 0;
  constructor(private readonly script: ShotScore[]) {}
  async scoreShot(_outputUrl: string, _refs: ReferenceSet): Promise<ShotScore> {
    const i = Math.min(this.idx, this.script.length - 1);
    this.idx += 1;
    return this.script[i] ?? { faceCosine: null, sceneScore: null };
  }
}
