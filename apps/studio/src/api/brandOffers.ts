// Brand-offers inbox model (studio section 6). HARD GATE: NO brand appears in a creator's content without
// explicit creator permission. The brand-offers inbox is OPT-IN: the creator reviews each eligible campaign
// and accepts / declines / requests-higher-payout PER BRAND. On accept, generation-time placement runs
// behind brand-safety + canon-safety filters (shown), is region-addressable, and the content/ad firewall is
// noted (brand data never crosses into content ranking).
//
// The brand tables are NOT in the hosted schema yet. There is no brand service to fetch from, so the inbox
// is a REAL EMPTY inbox: we never fabricate offers. The shapes below describe the offer contract for when
// the brand service lands; the live loader returns an empty list and the section renders the permission +
// firewall model so the surface communicates intent without inventing deals. No em dashes.

// The kind of placement a campaign requests. Each runs behind generation-time brand-safety + canon-safety
// filters once a creator accepts; none is ever inserted without explicit per-brand permission.
export type PlacementType =
  | "product_placement"
  | "scene_dressing"
  | "branded_segment"
  | "end_card";

export const PLACEMENT_LABEL: Record<PlacementType, string> = {
  product_placement: "Product placement",
  scene_dressing: "Scene dressing",
  branded_segment: "Branded segment",
  end_card: "End card",
};

// A creator's response to a single brand offer. requests-higher-payout is a negotiation, not an acceptance.
export type OfferDecision = "pending" | "accepted" | "declined" | "requested_higher";

export interface BrandOffer {
  id: string;
  brand: string;
  product: string;
  // The estimated payout in COINS (own-once economy; no live charge). A band would be shown for ranges.
  payoutEstimateCoins: number;
  // The region-addressable markets the campaign targets (ISO-ish labels for display).
  markets: string[];
  placementType: PlacementType;
  // Which episodes/series this campaign is compatible with (titles for display).
  episodeCompatibility: string[];
  // A one-line description of the scene the placement would appear in (preview, never auto-inserted).
  scenePreview: string;
  // The disclosure label viewers would see (paid-partnership transparency).
  disclosure: string;
}

// The live brand service does not exist yet. This loader returns an empty inbox so the section renders a
// REAL empty state with the permission + firewall model visible, never fabricated offers. When the brand
// service lands, replace this with a session-authed fetch.
export function loadBrandOffers(): BrandOffer[] {
  return [];
}
