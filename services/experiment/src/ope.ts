// Off-policy evaluation (OPE): estimate a CANDIDATE policy's value from logged decisions BEFORE it
// serves any traffic. This is the safety gate W3_DECISION_DESIGN.md section 5 requires: never ship a
// policy to a live, ledger-connected experience without an off-policy estimate of its value. Two
// estimators over the logged propensity: inverse-propensity-scoring (IPS) and a doubly-robust (DR)
// estimator. No em dashes.
//
// Setup. Each logged decision i has: context x_i, the arm a_i the LOGGING policy took, the logging
// propensity p_i = pi_log(a_i | x_i), the canon-filtered arm set, and the observed shaped reward r_i.
// A candidate policy pi_e induces, over the SAME arm set, an action distribution pi_e(. | x_i). We want
// V(pi_e) = E[ reward under pi_e ].
//
// IPS:  V_ips = (1/n) sum_i  ( pi_e(a_i | x_i) / p_i ) * r_i
//   Unbiased when p_i > 0 wherever pi_e puts mass (the logging policy explored every arm the candidate
//   would pick). High variance when the policies disagree, so we also report the effective sample size
//   and support the standard self-normalized variant (SNIPS) which is lower variance and bounded.
//
// DR:  V_dr = (1/n) sum_i  [ Q_hat(x_i, pi_e) + ( pi_e(a_i | x_i) / p_i ) * ( r_i - Q_hat(x_i, a_i) ) ]
//   where Q_hat is a reward model (supplied; here the trained candidate's mean-reward head). DR is
//   unbiased if EITHER the propensities OR the reward model is correct, and has lower variance than IPS
//   when Q_hat is decent. The correction term is IPS applied to the residual r - Q_hat.

import { rankArms, softmaxPropensity, meanReward, type ArmModel } from "./linucb.js";
import { REWARD_MIN, REWARD_MAX } from "./reward-weights.js";
import type { LoggedDecision } from "./dataset.js";

// A candidate policy: per-arm models plus its exploration alpha, exactly what trainModels produces and
// what the serving tier would load. The candidate is evaluated over each logged decision's own arm set.
export type CandidatePolicy = {
  arms: Record<string, ArmModel>;
  alpha: number;
  dim: number;
};

// pi_e(a | x): the candidate's probability on the logged arm, computed with the SAME softmax-over-LinUCB
// -scores the serving bandit logs as its propensity, so candidate and logging propensities are on one
// scale. Arms the candidate has never seen fall back to an evidence-free model (uniform-ish), which is
// the honest treatment of an unmodeled arm.
function candidateActionProb(
  policy: CandidatePolicy,
  decision: LoggedDecision,
  fallback: (id: string) => ArmModel
): number {
  const arms = decision.armSet.map((variantId) => ({
    variantId,
    model: policy.arms[variantId] ?? fallback(variantId),
  }));
  const ranked = rankArms(arms, decision.context, policy.alpha);
  return softmaxPropensity(ranked, decision.variantId);
}

// Q_hat(x, a): the candidate's predicted (exploitation) reward for an arm, clamped to the reward shaping
// bounds so the model head cannot push the DR estimate outside what the reward can physically be.
function qHat(policy: CandidatePolicy, decision: LoggedDecision, variantId: string, fallback: (id: string) => ArmModel): number {
  const model = policy.arms[variantId] ?? fallback(variantId);
  const q = meanReward(model, decision.context);
  return Math.min(REWARD_MAX, Math.max(REWARD_MIN, q));
}

export type OpeEstimate = {
  value: number; // estimated V(pi_e), the expected shaped reward per decision
  n: number; // logged decisions used (control rows excluded)
  effectiveSampleSize: number; // (sum w)^2 / sum w^2 over the importance weights; low = untrustworthy
  weightClipFraction: number; // fraction of decisions whose importance weight hit the clip ceiling
};

// Shared options. Control rows are excluded (no policy propensity). A weight clip caps the importance
// ratio to control IPS variance; report how often it bound. observedReward extracts r_i (default: the
// reward shaped into the dataset is not stored, so the caller supplies it; we read a provided field).
export type OpeOptions = {
  weightClip?: number; // max importance weight pi_e/p_log; default 100
  rewardOf: (d: LoggedDecision) => number; // observed shaped reward r_i for the logged decision
  fallbackArm: () => ArmModel; // evidence-free model for arms the candidate never saw
};

function eligible(rows: LoggedDecision[]): LoggedDecision[] {
  return rows.filter((r) => !r.isControl && r.propensity > 0);
}

function effSampleSize(weights: number[]): number {
  const sum = weights.reduce((s, w) => s + w, 0);
  const sumSq = weights.reduce((s, w) => s + w * w, 0);
  return sumSq === 0 ? 0 : (sum * sum) / sumSq;
}

// Inverse-propensity-scoring. Self-normalized (SNIPS): divide by the mean importance weight rather than
// n, which is lower variance, strictly bounded inside the observed reward range, and the form you want
// as a deploy gate. The clip fraction and effective sample size flag when the estimate is untrustworthy.
export function ips(rows: LoggedDecision[], policy: CandidatePolicy, opts: OpeOptions): OpeEstimate {
  const clip = opts.weightClip ?? 100;
  const used = eligible(rows);
  let clipped = 0;
  const weights: number[] = [];
  let weightedReward = 0;
  let weightSum = 0;
  for (const d of used) {
    const pe = candidateActionProb(policy, d, opts.fallbackArm);
    let w = pe / d.propensity;
    if (w > clip) {
      w = clip;
      clipped++;
    }
    weights.push(w);
    weightedReward += w * opts.rewardOf(d);
    weightSum += w;
  }
  // Self-normalized: divide by the sum of weights, not n. Falls back to 0 on an empty/degenerate set.
  const value = weightSum > 0 ? weightedReward / weightSum : 0;
  return {
    value,
    n: used.length,
    effectiveSampleSize: effSampleSize(weights),
    weightClipFraction: used.length ? clipped / used.length : 0,
  };
}

// Doubly-robust. V_dr = mean over decisions of [ baseline(x) + w * (r - Q_hat(x, a_logged)) ], where
// baseline(x) = E_{a ~ pi_e}[ Q_hat(x, a) ] is the candidate's modeled value of the state, taken over
// its own action distribution on the arm set. Unbiased if either the propensities or Q_hat is right.
export function doublyRobust(rows: LoggedDecision[], policy: CandidatePolicy, opts: OpeOptions): OpeEstimate {
  const clip = opts.weightClip ?? 100;
  const used = eligible(rows);
  let clipped = 0;
  const weights: number[] = [];
  let total = 0;
  for (const d of used) {
    // baseline: candidate action distribution over the arm set, weighting each arm's Q_hat.
    const armProbs = candidateActionDistribution(policy, d, opts.fallbackArm);
    let baseline = 0;
    for (const { variantId, prob } of armProbs) baseline += prob * qHat(policy, d, variantId, opts.fallbackArm);

    const pe = armProbs.find((a) => a.variantId === d.variantId)?.prob ?? 0;
    let w = pe / d.propensity;
    if (w > clip) {
      w = clip;
      clipped++;
    }
    weights.push(w);
    const correction = w * (opts.rewardOf(d) - qHat(policy, d, d.variantId, opts.fallbackArm));
    total += baseline + correction;
  }
  const value = used.length ? total / used.length : 0;
  return {
    value,
    n: used.length,
    effectiveSampleSize: effSampleSize(weights),
    weightClipFraction: used.length ? clipped / used.length : 0,
  };
}

// The candidate's full action distribution over an arm set, reusing the serving softmax.
function candidateActionDistribution(
  policy: CandidatePolicy,
  decision: LoggedDecision,
  fallback: () => ArmModel
): { variantId: string; prob: number }[] {
  const arms = decision.armSet.map((variantId) => ({
    variantId,
    model: policy.arms[variantId] ?? fallback(),
  }));
  const ranked = rankArms(arms, decision.context, policy.alpha);
  return decision.armSet.map((variantId) => ({
    variantId,
    prob: softmaxPropensity(ranked, variantId),
  }));
}

// The deploy gate. A candidate is accepted only if BOTH estimators put its value at or above the logging
// policy's on-policy value (the mean observed reward) by at least minLift, AND the effective sample size
// is large enough to trust the estimate. Returns the decision plus the evidence. This is the safety
// check that runs BEFORE publish, per design section 5.
export type GateResult = {
  accept: boolean;
  reasons: string[];
  ipsEstimate: OpeEstimate;
  drEstimate: OpeEstimate;
  loggedValue: number; // mean observed reward of the logging policy on eligible decisions
};

export function deployGate(
  rows: LoggedDecision[],
  policy: CandidatePolicy,
  opts: OpeOptions & { minLift?: number; minEffSampleSize?: number }
): GateResult {
  const minLift = opts.minLift ?? 0;
  const minEss = opts.minEffSampleSize ?? 1;
  const used = eligible(rows);
  const loggedValue = used.length ? used.reduce((s, d) => s + opts.rewardOf(d), 0) / used.length : 0;
  const ipsEstimate = ips(rows, policy, opts);
  const drEstimate = doublyRobust(rows, policy, opts);

  const reasons: string[] = [];
  if (used.length === 0) reasons.push("no eligible logged decisions (all control or zero-propensity)");
  if (ipsEstimate.value < loggedValue + minLift) reasons.push(`IPS value ${ipsEstimate.value.toFixed(4)} below logged ${loggedValue.toFixed(4)} + minLift ${minLift}`);
  if (drEstimate.value < loggedValue + minLift) reasons.push(`DR value ${drEstimate.value.toFixed(4)} below logged ${loggedValue.toFixed(4)} + minLift ${minLift}`);
  if (ipsEstimate.effectiveSampleSize < minEss || drEstimate.effectiveSampleSize < minEss) reasons.push(`effective sample size below ${minEss}`);

  return { accept: reasons.length === 0, reasons, ipsEstimate, drEstimate, loggedValue };
}
