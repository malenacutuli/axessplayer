// Brand-performance flywheel. Each placement's performance is logged on the SAME propensity-substrate SHAPE
// as content engagement events (screen_time / completion / attention / propensity), then a re-rank improves
// BRAND-TO-SCENE matching over time. The objective is SEPARATE from the content reward function: this code
// only ranks which brand creative fits which slot better, and it NEVER reads or writes content-ranking /
// decision tables (the content/ad plane firewall). No em dashes.

import type { BrandPerformance, FillCandidate } from "./types.js";

// The brand-match objective. A pure function of BRAND-plane performance signals only. It deliberately does
// NOT take any content reward / retention signal as input: that separation IS the firewall.
export function brandMatchScore(p: Pick<BrandPerformance, "screenTime" | "completion" | "attention">): number {
  // Bounded, monotonic in each brand signal. Weights are brand-match weights, not content reward weights.
  const completion = clamp01(p.completion);
  const attention = clamp01(p.attention);
  const screen = clamp01(p.screenTime / 30); // normalize ~30s of on-screen time
  return 0.4 * completion + 0.4 * attention + 0.2 * screen;
}

// Inverse-propensity-weighted mean brand-match score for a creative, over its logged performance rows. IPS
// makes the estimate honest under epsilon-greedy/demand-rail logged selection, exactly like the content
// plane's off-policy evaluation, but on the BRAND objective.
export function creativeIpsScore(rows: BrandPerformance[]): number {
  if (rows.length === 0) return 0;
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const w = r.propensity > 0 ? 1 / r.propensity : 0;
    num += w * brandMatchScore(r);
    den += w;
  }
  return den > 0 ? num / den : 0;
}

// Re-rank candidates for a slot by their learned brand-match score. history maps creativeRef -> its
// performance rows. Candidates with no history keep a neutral prior so a new creative still gets explored.
// This re-rank ONLY reorders brand candidates; it never touches cut selection or any content table.
export function rerankCandidates(
  candidates: FillCandidate[],
  history: Map<string, BrandPerformance[]>,
  neutralPrior = 0.5,
): FillCandidate[] {
  const scored = candidates.map((c) => {
    const rows = history.get(c.creativeRef);
    const score = rows && rows.length > 0 ? creativeIpsScore(rows) : neutralPrior;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.c);
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
