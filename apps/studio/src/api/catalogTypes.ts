// Catalog API shapes for the Branch & Endings editor (section 8) and Analytics (section 9). These mirror
// the documented catalog routes the studio consumes:
//   GET /series/:id/graph     -> SeriesGraphView   (nodes/edges/memoryVars/canon/pricing)
//   GET /series/:id/analytics -> SeriesAnalytics    (retention/branch perf/endings/funnel/cohorts)
// The catalog service is session-authed with the creator token; the studio only READS. We mirror the types
// locally (no contract codegen for these additive routes yet) so the browser bundle stays free of the
// service's node deps, and a drift surfaces as a typecheck break here. No em dashes.

// ---------------------------------------------------------------------------------------------------
// GET /series/:id/graph
// ---------------------------------------------------------------------------------------------------

// The kind of a graph node. Beats are the spine; branches are forks; endings reconverge or terminate;
// pov / intensity / premium are MERCHANDISED purchasable variants; locked is a coin/entitlement gate.
export type GraphNodeKind =
  | "beat"
  | "branch"
  | "ending"
  | "pov"
  | "intensity"
  | "premium"
  | "locked";

// A purchasable variant's merchandising, present on pov / intensity / premium nodes. priceCoins is the
// CREATOR-SET coin price (own-once); it is NOT a live Stripe rail. source records how the cut was authored.
export interface GraphNodePricing {
  priceCoins: number;
  // How the premium cut was produced: an uploaded master, or an AI generation (the AI path is unwired).
  source: "uploaded" | "ai_generated" | "none";
}

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  title: string;
  // Column/row hints for the SVG layout (depth columns, stacked rows). Optional: we lay out by depth if absent.
  col?: number;
  row?: number;
  // Memory variables this node reads / writes (shown in the inspector).
  reads?: string[];
  writes?: string[];
  // Merchandising for purchasable variants (pov / intensity / premium). Absent for spine beats / branches.
  pricing?: GraphNodePricing;
  // A locked node is gated behind a coin spend or entitlement until unlocked.
  locked?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  // The viewer choice that traverses this edge (null/undefined = an automatic transition).
  choice?: string | null;
  // The default-fallback edge the decision engine takes when no choice is made.
  isDefault?: boolean;
}

export interface MemoryVar {
  name: string;
  type: string;
  note: string;
}

// The constraint-solver verdict for the authored graph. valid=false BLOCKS publishing.
export interface CanonResult {
  valid: boolean;
  issues: CanonIssue[];
}

export interface CanonIssue {
  severity: "error" | "warning";
  message: string;
  // The node the issue is attached to, when the solver can localize it.
  nodeId?: string;
}

export interface SeriesGraphView {
  seriesId: string;
  seriesTitle: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  memoryVars: MemoryVar[];
  canon: CanonResult;
  // Series-level pricing context (e.g. the base premium price floor) the merchandiser shows.
  pricing?: { currency: "coins"; premiumFloor?: number };
}

// ---------------------------------------------------------------------------------------------------
// GET /series/:id/analytics
// ---------------------------------------------------------------------------------------------------

export interface BeatRetentionPoint {
  beatId: string;
  // 0..1 fraction of viewers who reached this beat still retained (where viewers swipe away).
  retention: number;
}

// An off-policy counterfactual lift, ALWAYS a band [low, high] with an optional center estimate. Never a
// bare point: a confident wrong number burns trust (CORRECTIONS C6 / LiftBand).
export interface LiftEstimate {
  low: number;
  high: number;
  center?: number;
}

export interface BranchPerformance {
  branchId: string;
  label?: string;
  lift: LiftEstimate;
}

export interface EndingDistributionPoint {
  endingId: string;
  label?: string;
  // Share of completers who reached this ending, 0..1.
  share: number;
}

export interface FunnelStep {
  step: string;
  // Count of viewers at this step of the paywall funnel.
  count: number;
}

export interface CohortSlice {
  cohort: string;
  completion: number;
  watchTimeMs: number;
}

export interface SeriesAnalytics {
  seriesId: string;
  seriesTitle: string;
  beatRetention: BeatRetentionPoint[];
  branchPerformance: BranchPerformance[];
  endingDistribution: EndingDistributionPoint[];
  funnel: FunnelStep[];
  // Overall completion rate 0..1 and mean watch time in ms.
  completion: number;
  watchTimeMs: number;
  byCohort: CohortSlice[];
}

// ---------------------------------------------------------------------------------------------------
// GET /series/:id/revenue  (services/catalog additive route)
// Revenue computed from coin_transactions with the 70/30 creator/platform split, broken down by source,
// episode, and cohort. Every monetary figure is in COINS (own-once economy); there is NO live Stripe rail.
// ---------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------
// GET /channels  and  GET /channel/:id  (existing catalog routes; the studio reuses them for section 13).
// These mirror the catalog service shapes (ChannelSummary / ChannelDetail) so a drift surfaces as a
// typecheck break here. No em dashes.
// ---------------------------------------------------------------------------------------------------

export interface ChannelSummary {
  id: string;
  slug: string;
  name: string;
  genres: string[];
  heroUrl: string | null;
  showCount: number;
}

export interface ChannelSeriesItem {
  seriesId: string;
  title: string;
  poster: string | null;
  // 0..5 accessibility-derived rating (no rating column exists; the catalog derives it from a11y coverage).
  rating: number;
  episodes: number;
  badges: { cc: boolean; ad: boolean; sign: boolean };
}

export interface ChannelDetail {
  id: string;
  name: string;
  heroUrl: string | null;
  showCount: number;
  series: ChannelSeriesItem[];
}

// ---------------------------------------------------------------------------------------------------
// GET /channel/:id/analytics  (services/catalog additive route, session-authed creator bearer)
//   -> { followers, followerTrend, seriesPerformance, notificationAudience, brandDeals }
// Channel-level analytics for the studio Channel section (13). brandDeals is present in the contract but
// the brand tables are not in the hosted schema yet, so it arrives EMPTY and the studio renders a real
// empty/coming-soon brand-deals surface (no fabricated deals). No em dashes.
// ---------------------------------------------------------------------------------------------------

export interface FollowerTrendPoint {
  // An ISO date or period label for the x-axis (e.g. "2026-05" or a week start).
  period: string;
  followers: number;
}

export interface ChannelSeriesPerformance {
  seriesId: string;
  title: string;
  views: number;
  // 0..1 completion rate.
  completion: number;
}

// A channel-level brand deal row. The brand tables are not in the hosted schema yet, so this array is
// EMPTY in every current environment; the type exists so the contract addition is honored when it lands.
export interface ChannelBrandDeal {
  id: string;
  brand: string;
  status: string;
  revenueCoins: number;
}

export interface ChannelAnalytics {
  followers: number;
  followerTrend: FollowerTrendPoint[];
  seriesPerformance: ChannelSeriesPerformance[];
  // The audience reachable by a notification (the notification-bell audience).
  notificationAudience: number;
  brandDeals: ChannelBrandDeal[];
}

// A revenue row by source (e.g. premium_unlock, series_unlock, rewarded_ad, subscription_share). The split
// is COMPUTED server-side from the gross: creatorShare = gross * 0.70, platformShare = gross * 0.30.
export interface RevenueBySource {
  source: string;
  gross: number;
  creatorShare: number;
  platformShare: number;
}

export interface RevenueByEpisode {
  episodeId: string;
  label?: string;
  gross: number;
  creatorShare: number;
  platformShare: number;
}

export interface RevenueByCohort {
  cohort: string;
  gross: number;
  creatorShare: number;
  platformShare: number;
}

export interface SeriesRevenue {
  bySource: RevenueBySource[];
  totalGross: number;
  // The aggregate 70/30 split across all sources, computed server-side.
  creator70: number;
  platform30: number;
  // The creator's current withdrawable balance in coins.
  payoutBalance: number;
  byEpisode: RevenueByEpisode[];
  byCohort: RevenueByCohort[];
}
