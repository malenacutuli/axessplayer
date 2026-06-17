// In-scene brand placement on the CONTENT plane. A placement fills an approved render-time slot on a
// beat_variant; it is NEVER an ad-plane interstitial, and an ad-CTR signal NEVER drives cut selection. The
// re-cutter chooses the cut by retention reward (services/decision); placement only fills an approved slot
// in the chosen cut and is measured by propensity logs for causal lift, not ad CTR. This module enforces
// that plane firewall and selects a safety-passed placement for a slot. No em dashes.

import { checkPlacementSafety, type Placement, type SceneContext } from "./safety.js";

// Ad-plane signals that must never enter cut selection (the content/ad plane firewall, mirrors C5).
export const AD_PLANE_SIGNALS = ["ad_ctr", "click_through_rate", "interstitial_completion", "impression_cpm"] as const;

// Throw if a cut-selection feature is an ad-plane signal. Keeps the re-cutter optimizing retention, never
// ad clicks (a HARD invariant: never let an ad-CTR optimizer pick a cut).
export function assertNotAdPlaneDriven(cutFeatureKeys: string[]): void {
  const leaked = cutFeatureKeys.filter((k) => (AD_PLANE_SIGNALS as readonly string[]).includes(k));
  if (leaked.length > 0) {
    throw new Error(`content/ad plane firewall: ad-plane signal(s) cannot drive cut selection: ${leaked.join(", ")}`);
  }
}

export type RenderSlot = { beatVariantId: string; slotId: string };
export type EligiblePlacement = { placement: Placement; bidUsd: number };
export type PlacementSelection = { brandId: string; bidUsd: number; propensity: number; explored: boolean };

// Select a placement for a slot among candidates that PASS the safety gate, by bid, epsilon-greedy with a
// logged propensity (so placement lift is measurable off-policy, like every other decision). Returns null
// when no candidate is safe (the slot renders with no brand, never an unsafe one).
export function selectPlacement(
  slot: RenderSlot,
  candidates: EligiblePlacement[],
  scene: SceneContext,
  epsilon: number,
  rng: () => number,
): PlacementSelection | null {
  const safe = candidates.filter((c) => checkPlacementSafety(c.placement, scene).ok);
  if (safe.length === 0) return null;
  const k = safe.length;
  let greedy = safe[0];
  for (const c of safe) if (c.bidUsd > greedy.bidUsd) greedy = c;
  let chosen: EligiblePlacement;
  if (k > 1 && rng() < epsilon) {
    chosen = safe[Math.min(k - 1, Math.floor(rng() * k))];
  } else {
    chosen = greedy;
  }
  const isGreedy = chosen.placement.brandId === greedy.placement.brandId;
  const propensity = k <= 1 || epsilon <= 0 ? 1 : isGreedy ? 1 - epsilon + epsilon / k : epsilon / k;
  return { brandId: chosen.placement.brandId, bidUsd: chosen.bidUsd, propensity, explored: !isGreedy };
}
