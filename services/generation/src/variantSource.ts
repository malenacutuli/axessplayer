// P10: the unified variant source interface. A beat variant comes from EITHER a pre-rendered asset (the
// filmed/uploaded path) OR a generation spec (produced on demand). resolveVariantSource turns either into
// a playable asset. A spec is generated only when (a) its tier is permitted and (b) the FinOps budget gate
// authorizes the spend. The B_likeness (be-the-protagonist likeness) tier is FENCED here (C9): it is a
// separate, consent-gated, heavily-reviewed track, never resolved through this path. Real-time world-model
// generation is likewise fenced; this interface is architected to accept it later. No em dashes.

import type { VariantTier, VariantRequest } from "./spec.js";
import { authorizeSpend, estimateSpecCostUsd, type CostBudget } from "./finops.js";

export type VariantSource =
  | { kind: "prerendered"; playbackUrl: string; tier: VariantTier }
  | { kind: "spec"; request: VariantRequest; estimatedShots: number };

export type ResolvedVariant = { playbackUrl: string; tier: VariantTier; generated: boolean };
export type ResolveError = { error: string; fenced?: boolean };

export function isResolved(x: ResolvedVariant | ResolveError): x is ResolvedVariant {
  return (x as ResolvedVariant).playbackUrl !== undefined;
}

// Tiers that must NOT be generated through this path. B_likeness is be-the-protagonist likeness insertion:
// the biggest legal liability, behind the consent ledger and a human review (CORRECTIONS C9).
export const FENCED_TIERS: VariantTier[] = ["B_likeness"];

// Injected generator: the real implementation runs the offline pipeline (services/generation/pipeline.ts)
// behind the backends cost gate; tests inject a fake.
export interface GenerateFn {
  (request: VariantRequest): Promise<{ playbackUrl: string }>;
}

export async function resolveVariantSource(
  source: VariantSource,
  deps: { budget: CostBudget; generate: GenerateFn },
): Promise<ResolvedVariant | ResolveError> {
  if (source.kind === "prerendered") {
    if (!source.playbackUrl) return { error: "prerendered source has no playback_url" };
    return { playbackUrl: source.playbackUrl, tier: source.tier, generated: false };
  }
  // generation spec path
  const tier = source.request.tier;
  if (FENCED_TIERS.includes(tier)) {
    return { error: `tier ${tier} (be-the-protagonist likeness) is fenced (C9); use the consent-gated likeness track`, fenced: true };
  }
  const estimateUsd = estimateSpecCostUsd(source.estimatedShots);
  const auth = authorizeSpend(deps.budget, estimateUsd);
  if (!auth.allowed) {
    return { error: `FinOps gate denied: ${auth.reason}`, fenced: true };
  }
  const out = await deps.generate(source.request);
  return { playbackUrl: out.playbackUrl, tier, generated: true };
}
