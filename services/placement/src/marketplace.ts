// Self-serve brand marketplace. A brand creates a campaign (budget, a max bid, category, target ratings);
// the matcher finds campaigns eligible to fill a scene's slot: the campaign targets the scene rating, has
// budget remaining, and the placement passes the brand-safety gate. Eligible campaigns become the bid
// candidates for selectPlacement. Pacing keeps a campaign from overspending its budget. No em dashes.

import { checkPlacementSafety, type ContentRating, type SceneContext } from "./safety.js";
import type { EligiblePlacement } from "./placement.js";

export type Campaign = {
  id: string;
  brandId: string;
  category: string;
  budgetUsd: number;
  spentUsd: number;
  maxBidUsd: number;
  targetRatings: ContentRating[];
};

export function budgetRemaining(c: Campaign): number {
  return Math.max(0, c.budgetUsd - c.spentUsd);
}

// Campaigns eligible to bid on a scene slot: targets the rating, has budget for at least one max bid, and
// passes the safety gate for this scene. Fails closed on safety.
export function eligibleCampaigns(campaigns: Campaign[], scene: SceneContext): Campaign[] {
  return campaigns.filter((c) => {
    if (!c.targetRatings.includes(scene.rating)) return false;
    if (budgetRemaining(c) < c.maxBidUsd || c.maxBidUsd <= 0) return false;
    return checkPlacementSafety({ brandId: c.brandId, category: c.category }, scene).ok;
  });
}

// Turn eligible campaigns into bid candidates for selectPlacement (bid = the campaign max bid).
export function toBidCandidates(campaigns: Campaign[]): EligiblePlacement[] {
  return campaigns.map((c) => ({ placement: { brandId: c.brandId, category: c.category }, bidUsd: c.maxBidUsd }));
}
