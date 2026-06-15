// The policy: a LinUCB contextual bandit over the named viewer feature vector. Explainable first
// (design 2): a linear reward model per arm, debuggable and cheap to serve. Deterministic given a seed
// so tests can pin behavior. The bandit ranks ONLY the canon-filtered arm set it is handed; it never
// sees a rejected arm. No em dashes.
//
// LinUCB scores each arm a as:  score(a) = theta_a . x  +  alpha * sqrt( x^T A_a^-1 x )
// where x is the viewer feature vector, A_a = I + sum(x x^T) over the arm's history, b_a = sum(reward x),
// and theta_a = A_a^-1 b_a. The first term is the predicted reward; the second is the exploration bonus.
// In scaffold mode the per-arm A and b are seeded to the identity prior (cold), so scoring is
// deterministic and reward shaping is NOT yet finalized against logged outcomes. The trainer that
// folds logged rewards into A and b is a stubbed interface (see logger.ts and the trainer note below).

import { EXPLORATION_ALPHA, EXPLAINABILITY_TOP_N } from "./config.js";
import { FEATURE_NAMES, FEATURE_DIM, type FeatureName } from "./features.js";

// Per-arm linear model state. Identity prior A and zero b mean "no evidence yet" (cold start).
export type ArmModel = { A: number[][]; Ainv: number[][]; b: number[] };

export type FeatureContribution = { feature: FeatureName; contribution: number };

export type RankedArm = {
  variantId: string;
  score: number;
  meanReward: number; // theta . x, the exploitation term
  explorationBonus: number; // alpha * sqrt(x^T Ainv x)
  topFeatures: FeatureContribution[]; // top-N named contributions, the explainability bar
};

export type BanditChoice = {
  chosen: RankedArm;
  ranked: RankedArm[]; // all arms, descending by score
  propensity: number; // P(chosen | context) under this policy, for off-policy evaluation
};

// ---- small dense linear algebra (FEATURE_DIM is tens; this is intentionally simple and exact) ----

function identity(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

function matVec(M: number[][], v: number[]): number[] {
  return M.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
}

function dot(a: number[], b: number[]): number {
  return a.reduce((s, x, i) => s + x * b[i], 0);
}

// Gauss-Jordan inverse. Deterministic. FEATURE_DIM is small so cost is irrelevant.
function inverse(M: number[][]): number[][] {
  const n = M.length;
  const a = M.map((row, i) => [...row, ...identity(n)[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) continue; // singular column; identity prior keeps this safe
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const d = a[col][col];
    for (let j = 0; j < 2 * n; j++) a[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[col][j];
    }
  }
  return a.map((row) => row.slice(n));
}

// A fresh, evidence-free arm model: identity prior. Deterministic.
export function newArmModel(): ArmModel {
  const A = identity(FEATURE_DIM);
  return { A, Ainv: identity(FEATURE_DIM), b: Array(FEATURE_DIM).fill(0) };
}

// theta_a = A_a^-1 b_a, the per-arm linear reward coefficients.
function theta(model: ArmModel): number[] {
  return matVec(model.Ainv, model.b);
}

// Top-N named feature contributions to the exploitation term: theta_i * x_i, largest absolute first.
// This is the explainability payload (config EXPLAINABILITY_TOP_N).
function topFeatures(th: number[], x: number[]): FeatureContribution[] {
  return FEATURE_NAMES.map((feature, i) => ({ feature, contribution: th[i] * x[i] }))
    .sort((p, q) => Math.abs(q.contribution) - Math.abs(p.contribution))
    .slice(0, EXPLAINABILITY_TOP_N);
}

// Deterministic argmax tie-break: on equal score, lower variantId wins. This is what makes the policy
// reproducible "given a seed"; here the seed is the (fixed) arm priors plus this stable ordering, so a
// given (viewer vector, arm set) always yields the same choice.
function rankArms(
  arms: { variantId: string; model: ArmModel }[],
  x: number[],
  alpha: number
): RankedArm[] {
  const ranked = arms.map(({ variantId, model }) => {
    const th = theta(model);
    const meanReward = dot(th, x);
    const variance = Math.max(0, dot(x, matVec(model.Ainv, x)));
    const explorationBonus = alpha * Math.sqrt(variance);
    return {
      variantId,
      score: meanReward + explorationBonus,
      meanReward,
      explorationBonus,
      topFeatures: topFeatures(th, x),
    };
  });
  ranked.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.variantId < b.variantId ? -1 : 1));
  return ranked;
}

// Convert the ranked scores to a logged propensity via a softmax over scores. LinUCB is argmax-greedy,
// but for honest off-policy evaluation we log the probability mass the policy placed on the chosen arm.
// A softmax is a defensible, smooth propensity that is strictly positive (so IPS does not divide by
// zero) and deterministic. Single-arm sets get propensity 1.
function softmaxPropensity(ranked: RankedArm[], chosenId: string): number {
  if (ranked.length <= 1) return 1;
  const max = Math.max(...ranked.map((r) => r.score));
  const exps = ranked.map((r) => Math.exp(r.score - max));
  const sum = exps.reduce((s, e) => s + e, 0);
  const idx = ranked.findIndex((r) => r.variantId === chosenId);
  return exps[idx] / sum;
}

// Rank the (already canon-filtered) arms and pick the top. Deterministic. Returns the chosen arm, the
// full ranking, and the logged propensity. The caller supplies each arm's model (identity prior in
// scaffold mode; trained matrices once the offline trainer is wired).
export function chooseArm(
  arms: { variantId: string; model: ArmModel }[],
  x: number[],
  alpha: number = EXPLORATION_ALPHA
): BanditChoice {
  if (arms.length === 0) throw new Error("no_successors");
  const ranked = rankArms(arms, x, alpha);
  const chosen = ranked[0];
  return { chosen, ranked, propensity: softmaxPropensity(ranked, chosen.variantId) };
}

// ---- Offline trainer interface (STUBBED for this cut, flagged) ----
// The real trainer folds attributed, reward-shaped logged outcomes into each arm's A and b nightly (or
// streaming), stamps a new policy_version, and publishes the matrices to KV. Here it is a clear
// interface with an in-memory fake so the serving path is complete and testable. Reward shaping is NOT
// finalized against the placeholder weights in scaffold mode.
export interface OfflineTrainer {
  // Given logged (context, chosen arm, attributed reward) tuples, return updated per-arm models.
  train(samples: TrainSample[]): Promise<Map<string, ArmModel>>;
}

export type TrainSample = { variantId: string; x: number[]; reward: number };

// FAKE trainer: a single online LinUCB update step (A += x x^T, b += reward x) over the samples. It is
// real, correct LinUCB arithmetic, but it runs in-memory on supplied samples rather than against a
// joined decision_log + outcomes dataset. Use it to prove the update math, NOT to claim measured lift.
export class InMemoryTrainer implements OfflineTrainer {
  async train(samples: TrainSample[]): Promise<Map<string, ArmModel>> {
    const models = new Map<string, ArmModel>();
    for (const s of samples) {
      const m = models.get(s.variantId) ?? newArmModel();
      for (let i = 0; i < FEATURE_DIM; i++) {
        for (let j = 0; j < FEATURE_DIM; j++) m.A[i][j] += s.x[i] * s.x[j];
        m.b[i] += s.reward * s.x[i];
      }
      m.Ainv = inverse(m.A);
      models.set(s.variantId, m);
    }
    return models;
  }
}
