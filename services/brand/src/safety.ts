// Brand-safety + canon-safety HARD filters. A fill candidate passes ONLY when every constraint holds. Fails
// CLOSED: any unmet constraint blocks the fill and returns a reason BEFORE any placement is written. These
// are the prompt-19 / P10 hard gates: a disallowed brand/context pairing can never be filled. No em dashes.

import type { CanonConstraints, ContentRating, FillCandidate, PlacementSlot } from "./types.js";

const RATING_ORDER: Record<ContentRating, number> = { G: 0, PG: 1, PG13: 2, R: 3 };

// FLAGGED policy: the minimum content rating a brand category may appear in (alcohol/gambling/tobacco are
// adult only). Mirrors services/placement/safety.ts so the two planes agree on the category policy.
export const CATEGORY_MIN_RATING: Record<string, ContentRating> = {
  alcohol: "R",
  gambling: "R",
  tobacco: "R",
};

export type SafetyResult = { ok: boolean; reasons: string[] };

// BRAND-SAFETY: the slot must allow the creative's category, the category must be permitted at the slot's
// content rating, and the campaign's own excludeCategories must not name it (self-exclusion honoured).
export function checkBrandSafety(
  candidate: FillCandidate,
  slot: PlacementSlot,
  campaignExcludeCategories: string[] = [],
): SafetyResult {
  const reasons: string[] = [];
  if (slot.allowedCategories.length > 0 && !slot.allowedCategories.includes(candidate.category)) {
    reasons.push(`category ${candidate.category} is not in the slot allow list`);
  }
  const minRating = CATEGORY_MIN_RATING[candidate.category];
  if (minRating && RATING_ORDER[slot.contentRating] < RATING_ORDER[minRating]) {
    reasons.push(`category ${candidate.category} requires rating >= ${minRating}, slot is ${slot.contentRating}`);
  }
  if (campaignExcludeCategories.includes(candidate.category)) {
    reasons.push(`category ${candidate.category} is excluded by the campaign`);
  }
  return { ok: reasons.length === 0, reasons };
}

// CANON-SAFETY: the slot's canon_constraints must not forbid this brand, category, or creative era. This is
// the disallowed brand/CONTEXT pairing gate (a period drama forbidding a modern logo, a kids series
// forbidding alcohol). Fails closed.
export function checkCanonSafety(candidate: FillCandidate, canon: CanonConstraints): SafetyResult {
  const reasons: string[] = [];
  if ((canon.forbiddenCategories ?? []).includes(candidate.category)) {
    reasons.push(`canon forbids category ${candidate.category} in this scene`);
  }
  if ((canon.forbiddenBrands ?? []).includes(candidate.brandId)) {
    reasons.push(`canon forbids brand ${candidate.brandId} in this scene`);
  }
  if (candidate.creativeEra && (canon.forbiddenEras ?? []).includes(candidate.creativeEra)) {
    reasons.push(`canon forbids creative era ${candidate.creativeEra} in this scene`);
  }
  if (canon.era && candidate.creativeEra && candidate.creativeEra !== canon.era && (canon.forbiddenEras ?? []).length === 0) {
    // A slot pinned to an era rejects any creative declaring a different era (strict canon).
    reasons.push(`canon era is ${canon.era}, creative era is ${candidate.creativeEra}`);
  }
  return { ok: reasons.length === 0, reasons };
}

// GROUND-TRUTH SURFACE match (no CV): if the creative declares supported surfaces, the slot's authored
// ground-truth surface must be among them. This uses authored metadata, never vision reconstruction.
export function checkSurfaceFit(candidate: FillCandidate, slot: PlacementSlot): SafetyResult {
  const reasons: string[] = [];
  const slotSurface = slot.groundTruthMetadata.surface;
  if (candidate.supportedSurfaces && candidate.supportedSurfaces.length > 0 && slotSurface) {
    if (!candidate.supportedSurfaces.includes(slotSurface)) {
      reasons.push(`creative does not support the slot ground-truth surface ${slotSurface}`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

// The combined HARD gate. Runs brand-safety, canon-safety, and surface-fit. Returns the union of reasons so
// the caller can report WHY a pairing was blocked. ok only when all pass.
export function checkFillAllowed(
  candidate: FillCandidate,
  slot: PlacementSlot,
  campaignExcludeCategories: string[] = [],
): SafetyResult {
  const parts = [
    checkBrandSafety(candidate, slot, campaignExcludeCategories),
    checkCanonSafety(candidate, slot.canonConstraints),
    checkSurfaceFit(candidate, slot),
  ];
  const reasons = parts.flatMap((p) => p.reasons);
  return { ok: reasons.length === 0, reasons };
}
