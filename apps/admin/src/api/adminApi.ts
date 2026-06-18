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
