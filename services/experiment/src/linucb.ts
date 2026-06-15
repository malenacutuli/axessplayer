// LinUCB per-arm linear model: the parameter store the offline trainer updates and off-policy
// evaluation scores against. The ArmModel shape and the update arithmetic MIRROR the decision engine's
// serving bandit (services/decision/src/bandit.ts), which is READ-ONLY to this package. We consume its
// types by mirroring them so a policy trained here is byte-compatible with what the serving tier loads
// from KV. Dense small linear algebra: FEATURE_DIM is tens, so exact Gauss-Jordan is fine. No em dashes.
//
// LinUCB:  score(a) = theta_a . x + alpha * sqrt(x^T A_a^-1 x),  theta_a = A_a^-1 b_a,
//          A_a = lambda*I + sum(x x^T),  b_a = sum(reward * x).

export type ArmModel = { A: number[][]; Ainv: number[][]; b: number[] };

export function identity(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

export function matVec(M: number[][], v: number[]): number[] {
  return M.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
}

export function dot(a: number[], b: number[]): number {
  return a.reduce((s, x, i) => s + x * b[i], 0);
}

// Gauss-Jordan inverse. Deterministic. Mirrors decision/bandit.ts inverse: a singular column is left as
// the identity prior contribution rather than throwing, so an evidence-free arm stays well defined.
export function inverse(M: number[][]): number[][] {
  const n = M.length;
  const a = M.map((row, i) => [...row, ...identity(n)[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) continue;
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

// A fresh, evidence-free arm model with a ridge prior A = lambda*I. lambda=1 matches the serving
// bandit's identity prior. Deterministic.
export function newArmModel(dim: number, lambda = 1): ArmModel {
  const A = identity(dim).map((row) => row.map((v) => v * lambda));
  return { A, Ainv: identity(dim).map((row) => row.map((v) => v / lambda)), b: Array(dim).fill(0) };
}

// theta_a = A_a^-1 b_a, the per-arm linear reward coefficients.
export function theta(model: ArmModel): number[] {
  return matVec(model.Ainv, model.b);
}

// Predicted (exploitation) reward for context x under this arm: theta . x.
export function meanReward(model: ArmModel, x: number[]): number {
  return dot(theta(model), x);
}

// One LinUCB rank-1 update folded into the arm: A += x x^T, b += reward*x, then refresh Ainv. Mutates
// and returns the model. Identical arithmetic to decision/bandit.ts InMemoryTrainer so a model trained
// here matches the serving update exactly.
export function foldSample(model: ArmModel, x: number[], reward: number): ArmModel {
  const dim = model.b.length;
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) model.A[i][j] += x[i] * x[j];
    model.b[i] += reward * x[i];
  }
  model.Ainv = inverse(model.A);
  return model;
}

// Deep copy so a candidate policy never aliases the logging policy's matrices.
export function cloneArm(m: ArmModel): ArmModel {
  return { A: m.A.map((r) => [...r]), Ainv: m.Ainv.map((r) => [...r]), b: [...m.b] };
}

export type RankedArm = { variantId: string; score: number; meanReward: number; explorationBonus: number };

// Rank the (already canon-filtered) arms by LinUCB score. Deterministic tie-break: lower variantId wins,
// matching the serving bandit so an evaluated policy reproduces the served choice. Returns descending.
export function rankArms(
  arms: { variantId: string; model: ArmModel }[],
  x: number[],
  alpha: number
): RankedArm[] {
  const ranked = arms.map(({ variantId, model }) => {
    const mr = meanReward(model, x);
    const variance = Math.max(0, dot(x, matVec(model.Ainv, x)));
    const explorationBonus = alpha * Math.sqrt(variance);
    return { variantId, score: mr + explorationBonus, meanReward: mr, explorationBonus };
  });
  ranked.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.variantId < b.variantId ? -1 : 1));
  return ranked;
}

// Softmax propensity over scores: the probability mass the policy places on a given arm. Strictly
// positive so it is a valid action-distribution for off-policy evaluation. Single arm gets 1. Mirrors
// decision/bandit.ts softmaxPropensity exactly so candidate and logged propensities are on one scale.
export function softmaxPropensity(ranked: RankedArm[], variantId: string): number {
  if (ranked.length <= 1) return 1;
  const max = Math.max(...ranked.map((r) => r.score));
  const exps = ranked.map((r) => Math.exp(r.score - max));
  const sum = exps.reduce((s, e) => s + e, 0);
  const idx = ranked.findIndex((r) => r.variantId === variantId);
  if (idx < 0) return 0;
  return exps[idx] / sum;
}
