// P5-T2 multi-task ranker + exploration. Linear heads over item features predict completion, the
// DURATION-DEBIASED watch fraction (never raw watch_ms, so long content is not favored), and return. The
// ranking score is a weighted blend. Head and task weights are PLACEHOLDERS flagged for the reward/ranking
// weights founder sign-off; the defaults read the matching feature so the ranker is sensible cold-start.
// Exploration keeps support over the catalog so the recommender keeps learning. No em dashes.

import { dot } from "./twoTower.js";

export type Head = number[]; // linear weights over the item feature vector
export type RankerWeights = { completion: Head; watch: Head; returns: Head };
export type TaskWeights = { completion: number; watch: number; returns: number };

// Item feature vector order (featureStore.itemFeatures): [avgCompletion, avgDebiasedWatch, returnRate, popularity].
// Cold-start heads read their matching feature plus a little popularity. FLAGGED for founder ratification.
export const DEFAULT_RANKER_WEIGHTS: RankerWeights = {
  completion: [1, 0, 0, 0.2],
  watch: [0, 1, 0, 0.2],
  returns: [0, 0, 1, 0.2],
};
// Return-dominant, watch secondary, never raw-watch-maximizing (design 5 / C4 spirit). FLAGGED.
export const DEFAULT_TASK_WEIGHTS: TaskWeights = { completion: 0.3, watch: 0.3, returns: 0.4 };

export function predictHeads(features: number[], w: RankerWeights): { completion: number; watch: number; returns: number } {
  return { completion: dot(features, w.completion), watch: dot(features, w.watch), returns: dot(features, w.returns) };
}

export function rankScore(features: number[], w: RankerWeights = DEFAULT_RANKER_WEIGHTS, taskW: TaskWeights = DEFAULT_TASK_WEIGHTS): number {
  const h = predictHeads(features, w);
  return taskW.completion * h.completion + taskW.watch * h.watch + taskW.returns * h.returns;
}

export type Candidate = { seriesId: string; features: number[] };
export type Ranked = { seriesId: string; score: number };

export function rankCandidates(candidates: Candidate[], w?: RankerWeights, taskW?: TaskWeights): Ranked[] {
  const ranked = candidates.map((c) => ({ seriesId: c.seriesId, score: rankScore(c.features, w, taskW) }));
  ranked.sort((a, b) => (b.score - a.score) || (a.seriesId < b.seriesId ? -1 : a.seriesId > b.seriesId ? 1 : 0));
  return ranked;
}

// Epsilon-greedy exploration over the ranked list: with probability epsilon, promote a uniformly random
// candidate to the front (keeping the rest in order), else keep the exploit order. Returns a new list and
// the propensity of the surfaced top item, so feed exploration is itself loggable for off-policy analysis.
export function exploreRank(ranked: Ranked[], epsilon: number, rng: () => number): { list: Ranked[]; topPropensity: number } {
  const k = ranked.length;
  if (k <= 1 || epsilon <= 0) return { list: ranked, topPropensity: 1 };
  if (rng() < epsilon) {
    const idx = Math.min(k - 1, Math.floor(rng() * k));
    const picked = ranked[idx];
    const rest = ranked.filter((_, i) => i !== idx);
    const isGreedy = idx === 0;
    return { list: [picked, ...rest], topPropensity: isGreedy ? 1 - epsilon + epsilon / k : epsilon / k };
  }
  return { list: ranked, topPropensity: 1 - epsilon + epsilon / k };
}
