// ADMIN API client. Bound to the ADMIN API CONTRACT over VITE_ADMIN_API_BASE_URL with an operator bearer
// token. Every endpoint is operator-authed and RBAC-gated server side; this client only carries the
// bearer and shapes the typed responses. The base url is injected through VITE_ADMIN_API_BASE_URL so one
// build can point at mocks, staging, or production; the dev default is the same-origin "/admin" prefix
// that the Vite dev proxy forwards to the local content service. No em dashes.

/* ----------------------------------- Roles ----------------------------------- */
// The eight operator roles from the contract. RBAC is enforced server side; the UI mirrors it (see
// src/access/rbac.ts) so a viewer never sees a control they cannot use.
export type OperatorRole =
  | "Owner"
  | "Admin"
  | "Content"
  | "Finance"
  | "Marketing"
  | "Moderation"
  | "Support"
  | "ReadOnly";

export interface Operator {
  id: string;
  name: string;
  email: string;
}

// GET /admin/me
export interface AdminMe {
  operator: Operator;
  role: OperatorRole;
}

/* --------------------------------- Dashboard --------------------------------- */
// GET /admin/dashboard. Each KPI carries the route it drills through to (drillTo), so a card click opens
// its filtered report. A trend may be a point string OR a counterfactual band (always shown as a band,
// never a point, per the hard gate).
export interface KpiBand {
  low: number;
  high: number;
  center?: number;
  label?: string;
}
export interface DashboardKpi {
  key: string;
  label: string;
  value: string;
  trend?: string;
  // Optional counterfactual interval. When present the card renders a LiftBand, never a single number.
  band?: KpiBand;
  // Route this card drills through to (a filtered report route). No dead end: the target always renders.
  drillTo: string;
  tone?: "neutral" | "gold" | "green";
}
export interface DashboardSeriesPoint {
  label: string;
  // Stacked revenue-by-source segments (or any banded series), rendered as bands, not points.
  segments: Array<{ key: string; value: number }>;
}
export interface DashboardSeries {
  key: string;
  label: string;
  points: DashboardSeriesPoint[];
}
export interface AdminDashboard {
  kpis: DashboardKpi[];
  topSeries: DashboardSeries[];
}

/* ---------------------------------- Content ---------------------------------- */
export type ContentStatus = "live" | "review" | "processing" | "draft" | "failed";
export type ContentKind = "channel" | "series" | "episode" | "variant";

// A node in the content entity tree (channel -> series -> episode -> variant). The list/tree from
// GET /admin/content; the same shape is returned for a detail node from GET /admin/content/:id.
export interface ContentNode {
  id: string;
  kind: ContentKind;
  title: string;
  status: ContentStatus;
  channel?: string;
  variantCount?: number;
  a11yCoverage?: number; // 0..100
  provenanceVerified?: boolean;
  children?: ContentNode[];
}
export interface AdminContentList {
  tree: ContentNode[];
}
export interface AdminContentDetail {
  node: ContentNode;
  // Read-only this wave. Editing + publish states come later; the UI shows them disabled with a
  // "coming soon" affordance (no dead end).
  meta: Array<{ label: string; value: string }>;
}

/* --------------------------------- Story graph -------------------------------- */
// GET /admin/story-graph/:seriesId -> a versioned adaptive graph. Node kinds mirror the contract:
// episode/beat/branch/ending/pov/intensity/premium/locked. Edges carry the choice that traverses them
// (with an optional decision timer and a default-fallback flag). Memory variables are the per-viewer state
// each branch reads/writes. Pricing (per-branch / per-ending coin cost) is DISPLAY-ONLY in the UI; a change
// is a founder sign-off, never an operator/agent action. No em dashes.
export type StoryNodeKind =
  | "episode"
  | "beat"
  | "branch"
  | "ending"
  | "pov"
  | "intensity"
  | "premium"
  | "locked";

export interface StoryNode {
  id: string;
  kind: StoryNodeKind;
  title: string;
  // Layout column (depth from the episode root) and row within the column. Server may omit; the client
  // falls back to a computed layered layout when absent.
  col?: number;
  row?: number;
  // Memory variables this node reads / writes (branch logic). Display only.
  reads?: string[];
  writes?: string[];
  // Per-node pricing (premium cuts, locked endings). Coin cost, display only.
  priceCoins?: number;
  // Whether this node is gated (premium/locked). Display only.
  locked?: boolean;
}
export interface StoryEdge {
  id: string;
  from: string;
  to: string;
  // The choice label that traverses this edge (a branch decision the viewer makes).
  choice?: string;
  // Decision timer in seconds, when this edge is a timed choice.
  timerSec?: number;
  // The default fallback edge taken when the timer expires (canon rule).
  isDefault?: boolean;
}
export interface MemoryVar {
  name: string;
  type: "bool" | "int" | "enum" | "string";
  // Human-readable description of what the variable tracks. Display only.
  note?: string;
}
export interface StoryCanonRule {
  id: string;
  rule: string;
}
export interface StoryGraph {
  seriesId: string;
  seriesTitle: string;
  version: number;
  nodes: StoryNode[];
  edges: StoryEdge[];
  memoryVars: MemoryVar[];
  canonRules: StoryCanonRule[];
  // Default fallback node id when a timed choice expires with no explicit default edge.
  defaultFallbackNodeId?: string;
}

// POST /admin/story-graph/:seriesId/validate -> a constraint-solver result.
export type ValidationSeverity = "error" | "warning" | "ok";
export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  // Node / edge ids this issue points at, for highlight on the diagram.
  nodeIds?: string[];
}
export interface StoryValidation {
  ok: boolean;
  issues: ValidationIssue[];
  checkedAt: string;
}

// POST /admin/story-graph/:seriesId/simulate -> a replayed viewer journey along a path.
export interface SimulateRequest {
  // Either an explicit node path, or the signals the decision runtime replays in dry-run.
  path?: string[];
  signals?: Record<string, string | number | boolean>;
}
export interface SimulateStep {
  nodeId: string;
  title: string;
  // Why the runtime chose this node (the choice taken or the canon rule applied). Display only.
  rationale: string;
  // Memory variable values after this step.
  memory: Record<string, string | number | boolean>;
}
export interface SimulateResult {
  visitedNodeIds: string[];
  steps: SimulateStep[];
  endingNodeId?: string;
}

/* -------------------------------- Media factory ------------------------------- */
// GET /admin/media-factory/jobs -> the auto-produce DAG. Each job is one upload/episode; stages are the DAG
// steps (encode, captions, AD, sign, dub, QA, ...) each with a status, cost, and the output asset id. The
// cost gate flags a job whose projected cost exceeds the budget; clearing it is an RBAC-gated approval.
export type StageStatus = "queued" | "running" | "done" | "failed" | "blocked" | "skipped";
export type JobState = "running" | "done" | "failed" | "blocked" | "needs_approval";

export interface MediaStage {
  name: string;
  status: StageStatus;
  // Stage cost in credits (compute/vendor). Display only; surfaced for the cost gate.
  cost: number;
  // Output asset id once the stage produces an artifact.
  assetId?: string;
  detail?: string;
}
export interface MediaJob {
  jobId: string;
  seriesId: string;
  seriesTitle: string;
  episodeTitle: string;
  state: JobState;
  stages: MediaStage[];
  // Total projected cost and the budget gate. overBudget true => an approval is required to proceed.
  projectedCost: number;
  budget: number;
  overBudget: boolean;
}
export interface MediaFactoryJobs {
  jobs: MediaJob[];
}

/* ------------------------------ Accessibility -------------------------------- */
// GET /admin/accessibility -> publish-gating readiness. readiness is the per-series score + blockers;
// perTrack is the per-track / per-language QA matrix (CWI captions, AD, sign, dub); reviewQueue is the
// Deaf-review queue. The readiness score gates publish.
export type TrackKind = "captions" | "audio_description" | "sign" | "dub";
export type QaStatus = "ready" | "in_qa" | "drafted" | "missing" | "failed";

export interface ReadinessRow {
  seriesId: string;
  seriesTitle: string;
  // 0..100 publish-gating readiness score.
  score: number;
  // What is blocking a higher score / publish. Empty when ready.
  blockers: string[];
}
export interface PerTrackRow {
  seriesId: string;
  seriesTitle: string;
  track: TrackKind;
  language: string;
  status: QaStatus;
  // Coverage 0..100 for this track/language.
  coverage: number;
}
export interface ReviewItem {
  id: string;
  seriesTitle: string;
  episodeTitle: string;
  track: TrackKind;
  language: string;
  // Who must review (the sovereign Deaf-review queue is sign-track gated).
  reviewer: string;
  submittedAt: string;
}
export interface AdminAccessibility {
  readiness: ReadinessRow[];
  perTrack: PerTrackRow[];
  reviewQueue: ReviewItem[];
}

/* ---------------------------- Brand integration ------------------------------ */
// Section 7. The content/ad PLANE FIREWALL is a hard gate: brand/ad data and decisions never cross into
// content ranking. These shapes carry the brand side only; nothing here is ever fed to cut selection or the
// recommendation surface, and the UI labels that boundary explicitly. Brand tables are NOT in the hosted
// schema yet, so GET /admin/brands|campaigns|placements return empty arrays today; the UI renders a real
// "no campaigns yet" empty state plus the firewall note (no dead end), never fabricated rows. Deal model,
// suitability + brand-safety scores, targeting, sponsored disclosure, approval workflow, and revenue
// attribution (counterfactual lift as a BAND) are all display-only operator reads. No em dashes.
export type DealModel = "CPM" | "CPA" | "CPC" | "flat";
export type CampaignStatus = "draft" | "in_review" | "approved" | "live" | "paused" | "ended";
export type ApprovalStep = "submitted" | "brand_safety" | "legal" | "operator_approval" | "approved" | "rejected";

export interface Brand {
  id: string;
  name: string;
  // The advertiser/agency account. Account-level only; never linked to content ranking.
  industry: string;
  // Aggregate brand-safety suitability score 0..100 (display only).
  safetyScore: number;
  campaignCount: number;
  status: "active" | "paused" | "prospect";
}
export interface Campaign {
  id: string;
  brandId: string;
  brandName: string;
  name: string;
  status: CampaignStatus;
  deal: DealModel;
  // Headline rate for the deal model (e.g. CPM rate, flat fee). Display only.
  rate: string;
  // Approval workflow position. Approval is a seam; not executed in this wave.
  approval: ApprovalStep;
  // High-level targeting summary (audience/context). Never a content-ranking input.
  targeting: string;
  flightStart?: string;
  flightEnd?: string;
}
export interface Placement {
  id: string;
  campaignId: string;
  campaignName: string;
  brandName: string;
  // The content slot this placement is linked to (series/episode), by title only.
  contentTitle: string;
  // The generation-time slot kind (where in the produce pipeline the placement is composited).
  slotKind: "pre_roll" | "mid_scene" | "product_dressing" | "end_card";
  // Suitability score for this slot 0..100 and brand-safety pass/flag (display only).
  suitabilityScore: number;
  brandSafe: boolean;
  // Sponsored disclosure label shown to the viewer (transparency requirement).
  disclosure: string;
  // Performance + revenue attribution. Lift is a counterfactual BAND, never a point.
  impressions: number;
  revenue: number;
  liftBand?: KpiBand;
}
export interface AdminBrands {
  brands: Brand[];
}
export interface AdminCampaigns {
  campaigns: Campaign[];
}
export interface AdminPlacements {
  placements: Placement[];
}

/* ---------------------------------- Users ------------------------------------ */
// Section 8. PRIVACY + DATA-MINIMIZATION hard gate: only the minimum profile fields are returned, access is
// logged server side, and NO personal/biometric data leaves the sovereign plane. The detail view marks the
// privacy-gated, access-logged sections explicitly. GDPR export/delete, ban/suspend, and audited refund are
// DESTRUCTIVE seams: RBAC-gated, confirmation-required, audit-logged, and NOT executed this wave (rendered
// disabled / coming-soon). No em dashes.
export type UserTier = "free" | "plus" | "premium";
export type SubscriptionStatus = "none" | "active" | "trialing" | "past_due" | "canceled";

export interface UserRow {
  id: string;
  // Minimized handle (no full legal name / email on the list view).
  handle: string;
  tier: UserTier;
  subscription: SubscriptionStatus;
  // Coin wallet balance (display only; the ledger is the source of truth).
  balanceCoins: number;
  // Coarse region only (data minimization: no precise location).
  region: string;
  createdAt: string;
}
export interface UserHistoryItem {
  // A minimized activity row (purchase / watch / branch). No raw event payloads.
  label: string;
  detail: string;
  at: string;
}
export interface UserDetail {
  user: UserRow;
  // A11y + language defaults the viewer set (so support can reproduce their experience).
  a11yDefaults: Array<{ label: string; value: string }>;
  // PRIVACY-GATED + minimized sections. Each carries an access-logged note in the UI.
  purchaseHistory: UserHistoryItem[];
  watchHistory: UserHistoryItem[];
  branchHistory: UserHistoryItem[];
  downloads: UserHistoryItem[];
  referrals: UserHistoryItem[];
  sessions: Array<{ device: string; lastSeen: string; ip: string }>;
}
export interface AdminUsers {
  users: UserRow[];
}

/* --------------------------------- Creators ---------------------------------- */
// Section 9. Read-only. The 70/30 revenue share is shown TRANSPARENTLY. Financial actions (payout release)
// are RBAC-gated (Finance/Admin/Owner) and rendered coming-soon (not executed). Rights/consent files and
// moderation/strike status are surfaced; no personal/biometric data off the sovereign plane. No em dashes.
export type KycStatus = "not_started" | "in_review" | "verified" | "rejected";
export type PayoutStatus = "pending" | "scheduled" | "paid" | "on_hold";
export type StrikeStatus = "clear" | "warning" | "suspended";

export interface CreatorRow {
  id: string;
  name: string;
  // Onboarding / KYC status (display only).
  kyc: KycStatus;
  // Lifetime earnings to the creator (the 70 side of the 70/30 split), in USD.
  earningsUsd: number;
  contentCount: number;
  payout: PayoutStatus;
  strikes: StrikeStatus;
  // Whether the creator is eligible for brand integrations (gated on rights + safety).
  brandEligible: boolean;
}
export interface CreatorDetail {
  creator: CreatorRow;
  // The transparent revenue split. creatorPct + platformPct === 100.
  split: { creatorPct: number; platformPct: number };
  contract: { id: string; signedAt: string; term: string };
  // Content library (titles only).
  library: Array<{ id: string; title: string; status: ContentStatus; variants: number }>;
  // Rights / consent files on record (provenance + likeness consent). Display only.
  rightsFiles: Array<{ label: string; status: "on_file" | "missing" | "expired"; updatedAt: string }>;
  // Moderation history (strikes / actions). Display only.
  moderation: Array<{ label: string; at: string; severity: "info" | "warning" | "strike" }>;
  // Earnings breakdown by source (display only). Brand earnings stay on the brand side of the firewall.
  earnings: Array<{ source: string; amountUsd: number }>;
}
export interface AdminCreators {
  creators: CreatorRow[];
}

/* ------------------------------- Monetization -------------------------------- */
// Section 10. GET /admin/monetization -> the pricing-rules engine config (READ ONLY this wave). Rules are
// scoped by country / platform / content-type / experiment-cohort and cover credit packs, subscriptions,
// trials, rewarded ads, premium / alt-ending / POV / intensity pricing, promo codes, regional pricing,
// tax / VAT, refunds, and chargebacks. Every mutation (create / edit a rule) is an RBAC-gated, audit-logged
// SEAM rendered disabled coming-soon; nothing here writes. The reward-function weights are DISPLAY-ONLY for
// every role: changing them is a founder sign-off, never an operator/agent action, so they carry no edit
// control and a visible note. Stripe is in TEST mode (a badge says so). No em dashes.
export type MonetizationRuleKind =
  | "credit_pack"
  | "subscription"
  | "trial"
  | "rewarded_ad"
  | "premium_cut"
  | "alt_ending"
  | "pov"
  | "intensity"
  | "promo_code"
  | "regional"
  | "tax_vat"
  | "refund"
  | "chargeback";

export interface MonetizationRule {
  id: string;
  kind: MonetizationRuleKind;
  name: string;
  // The price as a formatted string (coins or currency), display only. The ledger / Stripe is the source.
  price: string;
  // Scope dimensions. Any may be "all" (global default rule). Never an empty string.
  country: string;
  platform: string; // ios / android / web / all
  contentType: string; // series / episode / branch / ending / all
  cohort: string; // experiment cohort, or "all"
  status: "active" | "scheduled" | "paused" | "draft";
  // A short human note about what the rule does (e.g. "20% off, expires 2026-07-01"). Display only.
  note?: string;
}

// The reward-function weights. DISPLAY ONLY. Each weight is rendered read-only with the founder-sign-off
// note; there is no edit control and no mutation endpoint.
export interface RewardWeight {
  key: string;
  label: string;
  // The current weight value (0..1 or a signed contribution), shown as a formatted string. Display only.
  value: string;
  // What signal this weight applies to (e.g. completion, replay, accessibility usage). Display only.
  signal: string;
}

export interface AdminMonetization {
  // Stripe is always TEST in this build; the flag drives a visible badge and a "no live charges" note.
  stripeMode: "test" | "live";
  rules: MonetizationRule[];
  rewardWeights: RewardWeight[];
}

/* --------------------------------- Analytics --------------------------------- */
// Section 11. GET /admin/analytics?dim=... -> dashboards built on the canonical event taxonomy. The
// dimension switcher drives dim (content / series / episode / branch / ending / a11y / language /
// monetization / funnel / cohorts / retention / churn / LTV / CAC). Every counterfactual / lift figure is a
// BAND {low, high, center}, never a point. The UI exports the loaded rows to CSV client-side; saved
// segments and scheduled reports are coming-soon affordances. No em dashes.
export type AnalyticsDim =
  | "content"
  | "series"
  | "episode"
  | "branch"
  | "ending"
  | "a11y"
  | "language"
  | "monetization"
  | "funnel"
  | "cohorts"
  | "retention"
  | "churn"
  | "ltv"
  | "cac";

// A KPI summarizing the dimension (top of the report). value is a formatted string; an optional band makes
// it a counterfactual interval rendered as a LiftBand.
export interface AnalyticsKpi {
  key: string;
  label: string;
  value: string;
  band?: KpiBand;
}
// A generic report row. metric/value columns plus an optional counterfactual lift band for that row.
export interface AnalyticsRow {
  // The row label (series title, branch name, language, cohort, funnel step, ...).
  label: string;
  // Primary metric value (formatted), e.g. "78.4%" or "12,400".
  value: string;
  // Optional secondary metric (formatted), e.g. a delta or a paired figure.
  secondary?: string;
  // Optional counterfactual lift, shown as a band, never a point.
  band?: KpiBand;
}
export interface AnalyticsReport {
  dim: AnalyticsDim;
  title: string;
  // Column headers for the rows table (2 or 3 columns depending on whether secondary is used).
  columns: string[];
  kpis: AnalyticsKpi[];
  rows: AnalyticsRow[];
}

/* ---------------------------------- Growth ----------------------------------- */
// Section 12. GET /admin/growth -> the UA surface. creativeTests are the bandit win-rates (per creative arm,
// each with a win-rate band since it is estimated). channels are CAC / LTV / payback by channel + cohort,
// where LTV / CAC are bands when estimated. referral is the referral-loop health from mobile.referrals. No
// em dashes.
export interface CreativeArm {
  id: string;
  name: string;
  channel: string;
  impressions: number;
  // Bandit win-rate as a band (estimated), never a point. Percent positions of the interval.
  winRate: KpiBand;
  // Allocation the bandit currently gives this arm (0..100), display only.
  allocationPct: number;
  status: "live" | "paused" | "winner" | "exhausted";
}
export interface GrowthChannel {
  id: string;
  channel: string;
  cohort: string;
  // CAC in USD (a point: it is realized spend / installs).
  cacUsd: number;
  // LTV as a band (estimated/projected), never a point. USD-denominated band rendered as a LiftBand label.
  ltvBand: KpiBand;
  // Payback in months (a point estimate, with a band-backed LTV behind it).
  paybackMonths: number;
  // Installs / activations attributed to the channel-cohort.
  installs: number;
}
export interface ReferralHealth {
  // Headline loop metrics (display only). k-factor is the viral coefficient.
  invitesSent: number;
  invitesAccepted: number;
  acceptRatePct: number;
  kFactor: number;
  // The k-factor projection is a band (estimated), never a point.
  kFactorBand: KpiBand;
  // Funnel steps for the referral loop (sent -> accepted -> activated -> retained), as rows.
  funnel: Array<{ label: string; value: number }>;
}
export interface AdminGrowth {
  creativeTests: CreativeArm[];
  channels: GrowthChannel[];
  referral: ReferralHealth;
}

/* -------------------------------- Moderation --------------------------------- */
// Section 13 [THE GATE for viewer V8 social]. GET /admin/moderation/queue -> the moderation queue (UGC
// reports, comments, character-feed posts). The social tables do not exist yet, so the live endpoint
// returns an EMPTY queue; the UI renders a real empty state, never fabricated rows. The CSAM/illegal-content
// + harassment SCAN is a real INTERFACE wired to a provider later: when the scanner is unwired its verdict
// is "pending_provider", NEVER a fabricated "clean" result. report-review (approve/remove/escalate),
// block/mute, and takedown are RBAC-gated audit SEAMS rendered disabled this wave (the destructive ones are
// 501 seams server side; nothing executes here). GET /admin/moderation/policy -> the age-gating policy
// (minors blocked from mature community, no romantic/parasocial overlap) + rate-limit config. No em dashes.
export type ModerationItemKind = "report" | "comment" | "post";
// The scanner verdict. "pending_provider" is the ONLY verdict an unwired scanner returns; a clean verdict
// is never fabricated. "flagged" / "blocked" come from a real provider once wired.
export type ScanStatus = "pending_provider" | "clear" | "flagged" | "blocked";
export type ScanCategory = "csam" | "illegal" | "harassment" | "spam" | "self_harm";
export type ModerationState = "open" | "in_review" | "actioned" | "escalated";

export interface ModerationScan {
  // The provider-backed verdict. pending_provider when unwired (never a fabricated clean verdict).
  status: ScanStatus;
  // The categories the scan covers. The verdict applies across these once a provider is wired.
  categories: ScanCategory[];
  // Provider name once wired; null/undefined while pending. Display only.
  provider?: string;
  // Human note explaining the status (e.g. "scanner not yet wired; queued for provider").
  note?: string;
}
export interface ModerationItem {
  id: string;
  kind: ModerationItemKind;
  // Minimized author handle (no legal name / PII). The sovereign plane holds identity.
  authorHandle: string;
  // The reported/flagged text excerpt (truncated). For a report, the reason text.
  excerpt: string;
  // For a report: the reason category the reporter selected.
  reportReason?: string;
  // Where the content lives (series/episode/character feed), by title only.
  context: string;
  state: ModerationState;
  // The provider scan verdict (pending_provider when unwired).
  scan: ModerationScan;
  // Whether the author is a minor (drives age-gating). Coarse boolean only, no birthdate.
  authorIsMinor: boolean;
  reportedAt: string;
}
export interface ModerationQueue {
  items: ModerationItem[];
}

// GET /admin/moderation/policy -> age-gating + rules + rate-limit config (all display/read this wave).
export interface AgeGateRule {
  id: string;
  label: string;
  // The rule statement (e.g. "Minors blocked from mature community spaces"). Display only.
  rule: string;
  enforced: boolean;
}
export interface RateLimitRule {
  id: string;
  scope: string; // e.g. "comments per minute", "posts per day"
  limit: string; // formatted (e.g. "5 / min")
  appliesTo: string; // e.g. "all", "new accounts", "free tier"
}
export interface ModerationPolicy {
  ageGates: AgeGateRule[];
  rateLimits: RateLimitRule[];
  // The provider wiring status for the scanning interface (display only; drives the "unwired" banner).
  scanProvider: { wired: boolean; name?: string; note: string };
}

/* ---------------------------- Trust / consent ------------------------------- */
// Section 14 (the moat). GET /admin/trust/consent -> the consent ledger, MINIMIZED: scope/expiry/revocation
// status only; NO full biometric/PII is ever returned to the console (the sovereign plane holds it; the
// console shows a minimized projection + an access-logged note). Hard-delete of a consent record is a
// DESTRUCTIVE gated SEAM (501 server side; not executed here). GET /admin/trust/provenance -> C2PA status
// per asset + a public-verification affordance. The GDPR request queue is surfaced; GDPR delete/export are
// gated seams. Sovereign data-plane residency (EU / Swiss) is surfaced as an indicator. No em dashes.
export type ConsentScope = "likeness" | "voice" | "biometric" | "data_processing" | "marketing";
export type ConsentStatus = "active" | "expiring" | "expired" | "revoked";

export interface ConsentRecord {
  id: string;
  // Minimized subject reference (a stable pseudonymous id, never a legal name / raw PII).
  subjectRef: string;
  scope: ConsentScope;
  status: ConsentStatus;
  grantedAt: string;
  expiresAt?: string;
  // Where the underlying record physically lives (data residency). Display only.
  residency: "EU" | "CH" | "US";
  // Whether the full record is held on the sovereign plane (always true; the console only sees this minimized
  // projection). Drives the "minimized, access-logged" note.
  sovereign: boolean;
}
export interface ConsentLedger {
  records: ConsentRecord[];
  // The aggregate residency posture (the moat indicator).
  residency: { eu: number; ch: number; us: number };
}

export type ProvenanceStatus = "verified" | "pending" | "unsigned" | "failed";
export interface ProvenanceRecord {
  id: string;
  assetTitle: string;
  // C2PA manifest status. Display only; verification is performed against the signed manifest.
  status: ProvenanceStatus;
  // The signer (creator/studio) once signed. Display only.
  signer?: string;
  signedAt?: string;
  // A public-verification handle (a manifest id) the console can hand to a public C2PA verifier. Display only.
  manifestId?: string;
}
export interface ProvenanceLedger {
  records: ProvenanceRecord[];
}

export type GdprRequestKind = "export" | "delete" | "rectify" | "restrict";
export type GdprRequestState = "received" | "in_progress" | "awaiting_verification" | "completed" | "rejected";
export interface GdprRequest {
  id: string;
  kind: GdprRequestKind;
  // Minimized subject reference, never raw PII.
  subjectRef: string;
  state: GdprRequestState;
  receivedAt: string;
  // Statutory due date for the request (display only).
  dueBy: string;
}
export interface GdprQueue {
  requests: GdprRequest[];
}

export interface AdminTrust {
  consent: ConsentLedger;
  provenance: ProvenanceLedger;
  gdpr: GdprQueue;
}

/* ---------------------------------- Finance ---------------------------------- */
// Section 15. GET /admin/finance -> the double-entry coin ledger view (coin_transactions), revenue by
// source/market, creator payouts with the 70/30 split computed + shown, payout runs/statements (a run is a
// gated SEAM, not executed), and FinOps cost + budget cap + margin per title. Stripe is TEST until the
// live-rail decision (a badge says so). No live charges. No em dashes.
export type LedgerEntryKind = "purchase" | "spend" | "credit" | "refund" | "payout" | "chargeback" | "adjustment";

export interface LedgerEntry {
  id: string;
  at: string;
  kind: LedgerEntryKind;
  // The double-entry legs. debit + credit account names (display only; the ledger service is the source).
  debitAccount: string;
  creditAccount: string;
  // Amount in coins (the ledger is coin-denominated) and the USD equivalent (display only).
  amountCoins: number;
  amountUsd: number;
  // Minimized reference to the actor (pseudonymous), never raw PII.
  ref: string;
}
export interface RevenueBySource {
  source: string; // Coins / Subscriptions / Ads / Brand
  market: string; // market / region, or "all"
  amountUsd: number;
  sharePct: number;
}
export interface CreatorPayoutRow {
  creatorId: string;
  creatorName: string;
  // Gross attributable revenue, then the transparent 70/30 split computed from it.
  grossUsd: number;
  creatorPct: number; // 70
  platformPct: number; // 30
  creatorShareUsd: number;
  platformShareUsd: number;
  status: PayoutStatus;
  // The payout run this row belongs to (a statement), if scheduled.
  runId?: string;
}
export interface FinOpsCost {
  // The cost line (compute / vendor / storage / egress). Display only.
  line: string;
  spendUsd: number;
  // The budget cap for the line and whether it is over.
  capUsd: number;
  overCap: boolean;
}
export interface TitleMargin {
  titleId: string;
  title: string;
  revenueUsd: number;
  costUsd: number;
  // Margin percent (revenue - cost) / revenue. Display only.
  marginPct: number;
}
export interface AdminFinance {
  // Stripe is TEST until the live-rail decision; drives the visible badge + "no live charges" note.
  stripeMode: "test" | "live";
  ledger: LedgerEntry[];
  revenue: RevenueBySource[];
  payouts: CreatorPayoutRow[];
  finops: FinOpsCost[];
  margins: TitleMargin[];
}

/* ----------------------------------- Client ---------------------------------- */
export interface AdminApiConfig {
  baseUrl: string;
  // The operator bearer token. Real operator MFA is a CUTOVER GATE (see src/access). In dev a static
  // demo operator token is used so the console renders for review.
  token: string;
  fetchImpl?: typeof fetch;
}

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export class AdminApi {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AdminApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
    this.fetchImpl =
      config.fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : (undefined as never));
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        // Identity is the session subject, carried as the operator bearer, never a request body field.
        Authorization: `Bearer ${this.token}`,
      },
    });
    if (!res.ok) {
      throw new AdminApiError(res.status, `GET ${path} failed with ${res.status}`);
    }
    return (await res.json()) as T;
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new AdminApiError(res.status, `POST ${path} failed with ${res.status}`);
    }
    return (await res.json()) as T;
  }

  // GET /admin/me -> { operator, role }
  me(): Promise<AdminMe> {
    return this.get<AdminMe>("/admin/me");
  }

  // GET /admin/dashboard -> { kpis, topSeries }
  dashboard(): Promise<AdminDashboard> {
    return this.get<AdminDashboard>("/admin/dashboard");
  }

  // GET /admin/content -> the entity tree/list (channels->series->episodes->variants) with status
  content(): Promise<AdminContentList> {
    return this.get<AdminContentList>("/admin/content");
  }

  // GET /admin/content/:id -> detail
  contentDetail(id: string): Promise<AdminContentDetail> {
    return this.get<AdminContentDetail>(`/admin/content/${encodeURIComponent(id)}`);
  }

  // GET /admin/story-graph/:seriesId -> versioned graph JSON
  storyGraph(seriesId: string): Promise<StoryGraph> {
    return this.get<StoryGraph>(`/admin/story-graph/${encodeURIComponent(seriesId)}`);
  }

  // POST /admin/story-graph/:seriesId/validate -> constraint-solver result
  validateStoryGraph(seriesId: string): Promise<StoryValidation> {
    return this.post<StoryValidation>(`/admin/story-graph/${encodeURIComponent(seriesId)}/validate`);
  }

  // POST /admin/story-graph/:seriesId/simulate -> replayed journey
  simulateStoryGraph(seriesId: string, req: SimulateRequest): Promise<SimulateResult> {
    return this.post<SimulateResult>(`/admin/story-graph/${encodeURIComponent(seriesId)}/simulate`, req);
  }

  // GET /admin/media-factory/jobs -> produce DAG jobs
  mediaFactoryJobs(): Promise<MediaFactoryJobs> {
    return this.get<MediaFactoryJobs>("/admin/media-factory/jobs");
  }

  // GET /admin/accessibility -> readiness + per-track QA + review queue
  accessibility(): Promise<AdminAccessibility> {
    return this.get<AdminAccessibility>("/admin/accessibility");
  }

  // GET /admin/brands -> brand accounts (empty until the brand tables land; the UI renders a real empty
  // state plus the firewall note, never fabricated rows).
  brands(): Promise<AdminBrands> {
    return this.get<AdminBrands>("/admin/brands");
  }
  // GET /admin/campaigns -> campaigns across brands
  campaigns(): Promise<AdminCampaigns> {
    return this.get<AdminCampaigns>("/admin/campaigns");
  }
  // GET /admin/placements -> placement slots linked to content (brand side of the firewall)
  placements(): Promise<AdminPlacements> {
    return this.get<AdminPlacements>("/admin/placements");
  }

  // GET /admin/users -> minimized users list
  users(): Promise<AdminUsers> {
    return this.get<AdminUsers>("/admin/users");
  }
  // GET /admin/users/:id -> minimized, privacy-gated user detail (access logged server side)
  userDetail(id: string): Promise<UserDetail> {
    return this.get<UserDetail>(`/admin/users/${encodeURIComponent(id)}`);
  }

  // GET /admin/creators -> creators list
  creators(): Promise<AdminCreators> {
    return this.get<AdminCreators>("/admin/creators");
  }
  // GET /admin/creators/:id -> creator detail (read-only; financial actions gated elsewhere)
  creatorDetail(id: string): Promise<CreatorDetail> {
    return this.get<CreatorDetail>(`/admin/creators/${encodeURIComponent(id)}`);
  }

  // GET /admin/monetization -> pricing-rules config + display-only reward weights (SELECT-only read)
  monetization(): Promise<AdminMonetization> {
    return this.get<AdminMonetization>("/admin/monetization");
  }

  // GET /admin/analytics?dim=... -> a dimension-scoped report (counterfactual lift as bands, never points)
  analytics(dim: AnalyticsDim): Promise<AnalyticsReport> {
    return this.get<AnalyticsReport>(`/admin/analytics?dim=${encodeURIComponent(dim)}`);
  }

  // GET /admin/growth -> creative-test bandit win-rates, CAC/LTV/payback, referral-loop health
  growth(): Promise<AdminGrowth> {
    return this.get<AdminGrowth>("/admin/growth");
  }

  // GET /admin/moderation/queue -> the moderation queue (reports/comments/posts). Empty until the social
  // tables exist; the scanner verdict is pending_provider while unwired (never a fabricated clean verdict).
  moderationQueue(): Promise<ModerationQueue> {
    return this.get<ModerationQueue>("/admin/moderation/queue");
  }
  // GET /admin/moderation/policy -> age-gating + rules + rate-limit config (display/read this wave)
  moderationPolicy(): Promise<ModerationPolicy> {
    return this.get<ModerationPolicy>("/admin/moderation/policy");
  }

  // GET /admin/trust/consent -> the minimized consent ledger (never full biometric/PII)
  trustConsent(): Promise<ConsentLedger> {
    return this.get<ConsentLedger>("/admin/trust/consent");
  }
  // GET /admin/trust/provenance -> C2PA provenance status + public-verification handles
  trustProvenance(): Promise<ProvenanceLedger> {
    return this.get<ProvenanceLedger>("/admin/trust/provenance");
  }
  // GET /admin/trust/gdpr -> the GDPR request queue (delete/export are gated seams)
  trustGdpr(): Promise<GdprQueue> {
    return this.get<GdprQueue>("/admin/trust/gdpr");
  }

  // GET /admin/finance -> double-entry ledger, revenue by source/market, 70/30 payouts, FinOps cost
  finance(): Promise<AdminFinance> {
    return this.get<AdminFinance>("/admin/finance");
  }
}

// Resolve the ADMIN API base url from the runtime env. Defaults to the same-origin "/admin" prefix that
// the Vite dev proxy forwards to the local content service.
type EnvBag = Record<string, string | undefined>;
function readEnv(): EnvBag {
  const metaEnv = (import.meta as unknown as { env?: EnvBag }).env;
  return metaEnv ?? {};
}
export function resolveAdminBaseUrl(env: EnvBag = readEnv()): string {
  return env.VITE_ADMIN_API_BASE_URL ?? "/admin";
}
// The operator bearer. In dev a static demo token is used; production injects a real operator session
// token (MFA-backed) through VITE_ADMIN_OPERATOR_TOKEN.
export function resolveOperatorToken(env: EnvBag = readEnv()): string {
  return env.VITE_ADMIN_OPERATOR_TOKEN ?? "demo-operator-token";
}
