// Brand-safety constraint gate. A placement candidate passes ONLY when every constraint holds: the brand
// category is permitted for the scene's content rating, the brand does not match an excluded category for
// the scene, and there is no competitor brand already placed in the same scene. Fails closed: any unmet
// constraint rejects the placement. The policy maps are flagged for the brand-policy decision. No em dashes.

export type ContentRating = "G" | "PG" | "PG13" | "R";
const RATING_ORDER: Record<ContentRating, number> = { G: 0, PG: 1, PG13: 2, R: 3 };

export type Placement = { brandId: string; category: string };

export type SceneContext = {
  rating: ContentRating;
  // categories the scene must NOT carry a brand for (e.g. a kids scene excludes "alcohol").
  excludedCategories?: string[];
  // brand ids of direct competitors that, if already placed in this scene, block the candidate.
  competitorBrandIds?: string[];
  existingBrandIds?: string[];
};

// FLAGGED policy: the minimum content rating a category may appear in (alcohol/gambling are adult only).
export const CATEGORY_MIN_RATING: Record<string, ContentRating> = {
  alcohol: "R",
  gambling: "R",
  tobacco: "R",
};

export type SafetyResult = { ok: boolean; reasons: string[] };

export function checkPlacementSafety(p: Placement, ctx: SceneContext): SafetyResult {
  const reasons: string[] = [];
  const minRating = CATEGORY_MIN_RATING[p.category];
  if (minRating && RATING_ORDER[ctx.rating] < RATING_ORDER[minRating]) {
    reasons.push(`category ${p.category} requires rating >= ${minRating}, scene is ${ctx.rating}`);
  }
  if ((ctx.excludedCategories ?? []).includes(p.category)) {
    reasons.push(`category ${p.category} is excluded for this scene`);
  }
  const competitors = new Set(ctx.competitorBrandIds ?? []);
  if ((ctx.existingBrandIds ?? []).some((b) => competitors.has(b))) {
    reasons.push("a competitor brand is already placed in this scene");
  }
  return { ok: reasons.length === 0, reasons };
}
