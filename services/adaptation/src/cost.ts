// The cost gate. An adaptation job estimates its spend before committing; if the estimate exceeds the
// budget, the job is PAUSED (state='paused_over_budget') rather than spending. Pure and deterministic so
// it unit-tests. Per-capability unit costs are coarse placeholders (the real FinOps numbers live with the
// economy/generation workstreams); the gate logic, not the exact dollars, is what is load-bearing here.
// No em dashes.

import type { Capability } from "./tiers.js";

// Coarse per-capability cost in USD per minute of source. Tier A edits are cheap (metadata / pixel
// transforms); Tier B/C synthesis is expensive. PLACEHOLDER numbers, marked as such.
const COST_PER_MINUTE_USD: Record<Capability, number> = {
  vertical_reframe: 0.05,
  cut: 0.02,
  repace: 0.05,
  transcription: 0.1,
  captioning: 0.05,
  audio_description: 0.4,
  dub: 0.6,
  poster: 0.2,
  trailer: 0.5,
  logo_blur: 0.1,
  static_surface_placement: 1.5,
  lip_sync: 3.0,
  object_removal: 2.0,
  pov_from_existing_shots: 2.5,
  wardrobe_redress: 6.0,
  actor_replacement: 12.0,
  new_scene: 15.0,
  identity_across_clips: 20.0,
};

export interface CostEstimate {
  estimatedUsd: number;
  budgetUsd: number | null;
  overBudget: boolean;
  breakdown: { capability: Capability; minutes: number; unitUsd: number; usd: number };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Estimate the cost of one capability over a source of the given duration. A null budget means no cap
// (overBudget is always false). A non-null budget pauses the job when the estimate exceeds it.
export function estimateCost(
  capability: Capability,
  sourceDurationMs: number,
  budgetUsd: number | null,
): CostEstimate {
  const minutes = sourceDurationMs > 0 ? sourceDurationMs / 60000 : 0;
  const unitUsd = COST_PER_MINUTE_USD[capability] ?? 1;
  const usd = round2(minutes * unitUsd);
  const overBudget = budgetUsd != null && usd > budgetUsd;
  return {
    estimatedUsd: usd,
    budgetUsd,
    overBudget,
    breakdown: { capability, minutes: round2(minutes), unitUsd, usd },
  };
}
