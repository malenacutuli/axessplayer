// @axessplayer/brand domain types. Mirrors the additive mobile.* brand-rail schema (scripts/sql/
// 10_brand_rail.sql). These are the BRAND/AD plane entities only: no content-ranking or decision field
// appears here, and brand performance is a SEPARATE shape from the content reward function. No em dashes.

export type ContentRating = "G" | "PG" | "PG13" | "R";
export type DealModel = "CPM" | "CPA" | "CPC" | "flat";

export type BrandAccount = {
  id: string;
  name: string;
  kind: "brand" | "agency";
  contactEmail?: string;
  approvalState: "pending" | "approved" | "suspended" | "rejected";
  createdAt: string;
};

// Targeting + EXCLUSIONS. Allow lists narrow eligibility; exclusions hard-block a pairing. character
// exclusions / scene exclusions are part of brand-safety and canon-safety. demographic targeting carries
// NO personal/biometric identifier, only coarse cohort labels (the sovereign-plane rule).
export type Targeting = {
  country?: string[];
  language?: string[];
  demographic?: string[];
  genre?: string[];
  excludeCharacters?: string[];
  excludeScenes?: string[];
  excludeCategories?: string[];
};

export type BrandCampaign = {
  id: string;
  brandId: string;
  product: string;
  category: string;
  targeting: Targeting;
  dealModel: DealModel;
  rateCents: number;
  budgetCents: number;
  spentCents: number;
  status: "draft" | "active" | "paused" | "archived";
  approvalState: "pending" | "approved" | "rejected";
  freqCapPerViewer: number;
  createdAt: string;
};

// GROUND-TRUTH scene metadata. Authored geometry/lighting/surface for generation-time placement. This is
// NOT computer-vision reconstructed and carries no viewer tracking. The structural advantage.
export type GroundTruthMetadata = {
  surface?: string; // e.g. "billboard", "can-on-table", "tshirt"
  geometry?: Record<string, number>; // authored placement box / transform
  lighting?: string; // e.g. "warm-interior"
  occlusion?: number; // 0..1 authored visibility
  [k: string]: unknown;
};

// Canon-safety constraints: disallowed brand/context pairings for this slot (e.g. a period drama forbids a
// modern logo; a children's series forbids alcohol).
export type CanonConstraints = {
  forbiddenCategories?: string[];
  forbiddenBrands?: string[];
  era?: string; // canon era the creative must not violate
  forbiddenEras?: string[]; // creative eras incompatible with this slot
};

export type PlacementSlot = {
  id: string;
  seriesId: string;
  beatId: string;
  allowedCategories: string[];
  canonConstraints: CanonConstraints;
  groundTruthMetadata: GroundTruthMetadata;
  contentRating: ContentRating;
  createdAt: string;
};

// A candidate region-addressable branded variant for a slot. Carries the creative's declared category /
// brand / era so the canon + brand-safety filters can reject a disallowed pairing BEFORE the fill.
export type FillCandidate = {
  campaignId: string;
  brandId: string;
  category: string;
  region: string;
  creativeRef: string;
  creativeEra?: string;
  // declared surfaces the creative can render onto; matched against the slot ground truth (no CV).
  supportedSurfaces?: string[];
  // personalized creative -> Article 50 disclosure required.
  personalized?: boolean;
};

// Per-request viewer context. viewerHash is an OPAQUE per-viewer key used for FREQUENCY CAPS only, never an
// identity and never biometric. cohort labels mirror the campaign targeting allow lists.
export type ViewerContext = {
  viewerHash?: string;
  country?: string;
  language?: string;
  demographic?: string;
  genre?: string;
};

export type AuditRecord = {
  campaignId: string;
  brandId: string;
  creativeRef: string;
  region: string;
  targetingSnapshot: Targeting;
  dealModel: DealModel;
  rateCents: number;
  licensing: { demandRail: string; license: string };
  provenance: { groundTruth: true; cv: false; signedAt: string };
};

export type PlacementFill = {
  id: string;
  slotId: string;
  campaignId: string;
  region: string;
  viewerHash?: string;
  creativeRef: string;
  c2paSigned: boolean;
  article50: boolean;
  audit: AuditRecord;
  createdAt: string;
};

export type BrandPerformance = {
  id: string;
  fillId: string;
  screenTime: number;
  completion: number;
  attention: number;
  propensity: number;
  createdAt: string;
};

export type LedgerLine = {
  entryId: string;
  campaignId: string;
  fillId?: string;
  account: "campaign_budget" | "platform_revenue";
  direction: "debit" | "credit";
  amountCents: number;
  clientTxnId: string;
  mode: "test";
  createdAt: string;
};
