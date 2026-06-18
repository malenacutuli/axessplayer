// RBAC for the admin API. The (role, route, method) -> allow/deny matrix for the 8 operator roles, plus
// the route classifier that turns a concrete request path into the policy key the matrix is keyed on.
//
// Two orthogonal rules compose here:
//   1. ReadOnly (and every read-scoped role on a mutating method) may GET but never mutate. A non-GET on
//      any route by a role that lacks write on that route is a 403.
//   2. Per-route role scoping. The 8 roles map to functional surfaces (Finance sees the ledger, Content
//      sees the catalog, etc.). Owner and Admin see everything. ReadOnly may read everything but write
//      nothing. This wave ships only GET endpoints, so every shipped route resolves through the read
//      path; the write entries exist so the seam is real the moment a mutating route is added.
//
// Deny is the default: an unknown route or an unmapped (role, route) pair is denied, never silently
// allowed. No em dashes.

export const ROLES = [
  "Owner",
  "Admin",
  "Content",
  "Finance",
  "Marketing",
  "Moderation",
  "Support",
  "ReadOnly",
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

// The policy-level route key. A concrete path like /admin/content/abc-123 classifies to "content". The
// matrix is keyed on these stable surfaces, not on raw paths, so adding a sibling path under a surface
// does not require touching the matrix.
export type RouteKey =
  | "me"
  | "dashboard"
  | "content"
  | "storyGraph"
  | "mediaFactory"
  | "accessibility"
  // Section 7-9 surfaces. brands/campaigns/placements live on the AD plane (Marketing-owned). users is the
  // viewer-admin surface (Support-owned). creators is the creator-admin surface. payouts is the
  // creator-revenue surface (Finance-owned). gdpr/moderation are the DESTRUCTIVE surfaces (export/delete,
  // ban, refund) that require an elevated write role and are pure 501 seams this wave.
  | "brands"
  | "campaigns"
  | "placements"
  | "users"
  | "creators"
  | "payouts"
  | "gdpr"
  | "moderation"
  // Section 10-12 surfaces. monetization is the pricing-rules/config view (Finance/Admin/Owner write the
  // pricing-edit seams; everyone reads). analytics is a BROAD READ surface (every operator role reads the
  // dashboards; there is no analytics write). growth is the acquisition/referral/creative-test surface
  // (Marketing/Admin/Owner write; everyone reads). A pricing edit classifies to monetization with a write
  // method, which only the finance write roles pass; it is a 501 seam this slice.
  | "monetization"
  | "analytics"
  | "growth"
  // Section 13-15 surfaces (slice B). moderationQueue is the UGC moderation surface: read-broad (every
  // operator reads the queue + policy) and the approve/remove/escalate/block/takedown seams are gated to
  // Moderation/Admin/Owner. trust is the consent-ledger + C2PA-provenance + GDPR-queue surface: read-broad,
  // with consent-hard-delete / GDPR-delete gated to Admin/Owner only. finance is the double-entry ledger /
  // revenue / payout-accrual surface: read-broad, with the payout-run seam gated to Finance/Owner. The
  // destructive POST seams on these surfaces are 501 audit seams this slice (touch no data).
  | "moderationQueue"
  | "trust"
  | "finance"
  // Section 16-17 surfaces (slice B). health is the service-status surface: read by the operations roles
  // (Admin/Owner/Support); there is no health write (the registry is static this wave). settings is the
  // platform-settings surface: read-broad (audit-trail read is broad so any operator can review who-did-
  // what), with WRITES (feature-flag toggles) gated to Owner/Admin as 501 audit seams this wave.
  | "health"
  | "settings"
  | "unknown";

// Classify a request path into a policy RouteKey. Trailing-slash and id-suffix tolerant. An unrecognized
// path is "unknown", which the matrix denies for every role. story-graph covers the GET read and its
// validate/simulate POST sub-paths (the constraint solver and the journey walker are pure but are POSTs,
// so they resolve through the storyGraph write capability and are audit-logged as mutation seams).
export function classifyRoute(path: string): RouteKey {
  const clean = path.replace(/\/+$/, "");
  if (clean === "/admin/me") return "me";
  if (clean === "/admin/dashboard") return "dashboard";
  // Section 13-15 (slice B) classify FIRST so their own destructive sub-paths (e.g. a trust
  // consent /delete or a finance /payouts/run) resolve to the section's own write surface, not to the
  // generic gdpr (/delete) or moderation (/ban,/refund) destructive buckets below. Most specific first.
  if (clean === "/admin/moderation/queue" || clean === "/admin/moderation/policy" || clean.startsWith("/admin/moderation/")) {
    return "moderationQueue";
  }
  if (clean === "/admin/trust" || clean.startsWith("/admin/trust/")) return "trust";
  if (clean === "/admin/finance" || clean.startsWith("/admin/finance/")) return "finance";
  // Section 16-17 (slice B). health is a single read surface. settings covers the audit read, the roles
  // read model, and the feature-flag toggle write seams (all under /admin/settings/...).
  if (clean === "/admin/health" || clean.startsWith("/admin/health/")) return "health";
  if (clean === "/admin/settings" || clean.startsWith("/admin/settings/")) return "settings";
  if (clean === "/admin/content" || clean.startsWith("/admin/content/")) return "content";
  if (clean === "/admin/story-graph" || clean.startsWith("/admin/story-graph/")) return "storyGraph";
  if (clean === "/admin/media-factory/jobs" || clean.startsWith("/admin/media-factory")) return "mediaFactory";
  if (clean === "/admin/accessibility" || clean.startsWith("/admin/accessibility/")) return "accessibility";
  // Section 7-9. The DESTRUCTIVE seams classify FIRST so a path like /admin/users/:id/delete resolves to the
  // gdpr surface (elevated write), not the users read surface. Order matters: most specific first.
  if (clean.endsWith("/export") || clean.endsWith("/delete") || clean.startsWith("/admin/gdpr")) return "gdpr";
  if (clean.endsWith("/ban") || clean.endsWith("/refund")) return "moderation";
  if (clean === "/admin/brands" || clean.startsWith("/admin/brands/")) return "brands";
  if (clean === "/admin/campaigns" || clean.startsWith("/admin/campaigns/")) return "campaigns";
  if (clean === "/admin/placements" || clean.startsWith("/admin/placements/")) return "placements";
  if (clean === "/admin/payouts" || clean.startsWith("/admin/payouts/")) return "payouts";
  if (clean === "/admin/users" || clean.startsWith("/admin/users/")) return "users";
  if (clean === "/admin/creators" || clean.startsWith("/admin/creators/")) return "creators";
  // Section 10-12. A pricing-edit path (e.g. /admin/monetization/pricing) still classifies to monetization;
  // the write method gates it to the finance write roles, and the route is a 501 audit seam this slice.
  if (clean === "/admin/monetization" || clean.startsWith("/admin/monetization")) return "monetization";
  if (clean === "/admin/analytics" || clean.startsWith("/admin/analytics")) return "analytics";
  if (clean === "/admin/growth" || clean.startsWith("/admin/growth")) return "growth";
  return "unknown";
}

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export function isReadMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD";
}

// Per (role, routeKey) read/write capability. read = may GET; write = may mutate. The matrix is the
// single source of truth; the decision function below composes it with the read-vs-write method split.
interface Caps {
  read: boolean;
  write: boolean;
}

const ALL: Caps = { read: true, write: true };
const READ_ONLY: Caps = { read: true, write: false };
const NONE: Caps = { read: false, write: false };

// The matrix. "me" is readable by every authenticated operator (you can always resolve your own
// identity). "dashboard" is a cross-cutting read surface available to every role that has any console
// access; only Moderation and Support, which are case-scoped, are narrowed to read on it but not the
// finance-heavy cards (card-level filtering is a later slice and is noted, not faked, here). "content"
// is owned by Content/Owner/Admin for writes; everyone else reads.
//
// This wave is read-only end to end, so the write column is dormant. It is populated deliberately so the
// first mutating route added inherits a real, reviewed policy rather than an implicit allow.
// storyGraph mirrors content (Content/Owner/Admin write the validate/simulate seams; everyone else reads
// the graph). mediaFactory and accessibility are read surfaces this wave (no write entry shipped, so the
// write column is dormant for them); Content/Owner/Admin keep write so the first produce/QA mutation
// inherits a real policy, everyone else reads. Reward weights never appear on any of these surfaces.
//
// Section 7-9 additions (this slice):
//   - brands/campaigns/placements: the AD PLANE. Owned by Marketing for writes (brands->Marketing/Admin/
//     Owner). The plane firewall is enforced in the data layer (these queries never read/join content-
//     ranking/decision tables); RBAC here scopes WHO touches the ad surface. Other roles read it (so the
//     console renders the surface) but cannot write it.
//   - users: the viewer-admin surface, owned by Support for writes (users->Support/Admin/Owner). Reads are
//     PRIVACY-MINIMIZED in the data layer and access-logged; the matrix grants read to operator roles.
//   - creators: creator-admin, owned by Admin/Owner (creators->Admin/Owner). Other roles read.
//   - payouts: creator-revenue, owned by Finance for writes (payouts->Finance/Owner). Other roles read.
//   - gdpr (export/delete) and moderation (ban/refund): DESTRUCTIVE. write requires an ELEVATED role only.
//     gdpr writes: Admin/Owner (a GDPR export/delete is an account-data operation). moderation writes:
//     Moderation for ban, Finance for refund, plus Admin/Owner. These are pure 501 seams this wave: the
//     route audits and returns not_implemented WITHOUT touching data, but the write policy is real now so
//     the first wired mutation inherits a reviewed gate rather than an implicit allow. Reads on these
//     surfaces are not a thing (there is no GET /admin/gdpr); they exist only as write seams, so a GET
//     classifies to the underlying read surface (users/creators) instead.
//   - monetization (sections 10-12): the pricing-rules/config view. Owned by Finance for writes
//     (monetization->Finance/Admin/Owner); everyone else reads. The only mutating routes are the 501
//     pricing-edit seams, so write is dormant but real: the first wired pricing mutation inherits a
//     finance-gated, audit-logged policy. Reward weights are NOT a writable capability anywhere; they are
//     a display-only constant in the monetization payload, never a route.
//   - analytics: a BROAD READ surface. Every operator role reads the dashboards (read-broad); there is no
//     analytics write (the column stays dormant/READ_ONLY for all). Counterfactual lift is a band, never a
//     point, but that is a payload concern, not an RBAC one.
//   - growth: the acquisition/referral/creative-test surface. Owned by Marketing for writes
//     (growth->Marketing/Admin/Owner); everyone else reads. Write is dormant this slice (read-only routes).
const MATRIX: Record<Role, Record<Exclude<RouteKey, "unknown">, Caps>> = {
  Owner: { me: ALL, dashboard: ALL, content: ALL, storyGraph: ALL, mediaFactory: ALL, accessibility: ALL, brands: ALL, campaigns: ALL, placements: ALL, users: ALL, creators: ALL, payouts: ALL, gdpr: ALL, moderation: ALL, monetization: ALL, analytics: READ_ONLY, growth: ALL, moderationQueue: ALL, trust: ALL, finance: ALL, health: READ_ONLY, settings: ALL },
  Admin: { me: ALL, dashboard: ALL, content: ALL, storyGraph: ALL, mediaFactory: ALL, accessibility: ALL, brands: ALL, campaigns: ALL, placements: ALL, users: ALL, creators: ALL, payouts: ALL, gdpr: ALL, moderation: ALL, monetization: ALL, analytics: READ_ONLY, growth: ALL, moderationQueue: ALL, trust: ALL, finance: ALL, health: READ_ONLY, settings: ALL },
  Content: { me: READ_ONLY, dashboard: READ_ONLY, content: ALL, storyGraph: ALL, mediaFactory: ALL, accessibility: ALL, brands: READ_ONLY, campaigns: READ_ONLY, placements: READ_ONLY, users: READ_ONLY, creators: READ_ONLY, payouts: READ_ONLY, gdpr: NONE, moderation: NONE, monetization: READ_ONLY, analytics: READ_ONLY, growth: READ_ONLY, moderationQueue: READ_ONLY, trust: READ_ONLY, finance: READ_ONLY, health: NONE, settings: READ_ONLY },
  Finance: { me: READ_ONLY, dashboard: READ_ONLY, content: READ_ONLY, storyGraph: READ_ONLY, mediaFactory: READ_ONLY, accessibility: READ_ONLY, brands: READ_ONLY, campaigns: READ_ONLY, placements: READ_ONLY, users: READ_ONLY, creators: READ_ONLY, payouts: ALL, gdpr: NONE, moderation: ALL, monetization: ALL, analytics: READ_ONLY, growth: READ_ONLY, moderationQueue: READ_ONLY, trust: READ_ONLY, finance: ALL, health: NONE, settings: READ_ONLY },
  Marketing: { me: READ_ONLY, dashboard: READ_ONLY, content: READ_ONLY, storyGraph: READ_ONLY, mediaFactory: READ_ONLY, accessibility: READ_ONLY, brands: ALL, campaigns: ALL, placements: ALL, users: READ_ONLY, creators: READ_ONLY, payouts: READ_ONLY, gdpr: NONE, moderation: NONE, monetization: READ_ONLY, analytics: READ_ONLY, growth: ALL, moderationQueue: READ_ONLY, trust: READ_ONLY, finance: READ_ONLY, health: NONE, settings: READ_ONLY },
  Moderation: { me: READ_ONLY, dashboard: READ_ONLY, content: READ_ONLY, storyGraph: READ_ONLY, mediaFactory: READ_ONLY, accessibility: READ_ONLY, brands: READ_ONLY, campaigns: READ_ONLY, placements: READ_ONLY, users: READ_ONLY, creators: READ_ONLY, payouts: READ_ONLY, gdpr: NONE, moderation: ALL, monetization: READ_ONLY, analytics: READ_ONLY, growth: READ_ONLY, moderationQueue: ALL, trust: READ_ONLY, finance: READ_ONLY, health: NONE, settings: READ_ONLY },
  Support: { me: READ_ONLY, dashboard: READ_ONLY, content: READ_ONLY, storyGraph: READ_ONLY, mediaFactory: READ_ONLY, accessibility: READ_ONLY, brands: READ_ONLY, campaigns: READ_ONLY, placements: READ_ONLY, users: ALL, creators: READ_ONLY, payouts: READ_ONLY, gdpr: NONE, moderation: NONE, monetization: READ_ONLY, analytics: READ_ONLY, growth: READ_ONLY, moderationQueue: READ_ONLY, trust: READ_ONLY, finance: READ_ONLY, health: READ_ONLY, settings: READ_ONLY },
  ReadOnly: { me: READ_ONLY, dashboard: READ_ONLY, content: READ_ONLY, storyGraph: READ_ONLY, mediaFactory: READ_ONLY, accessibility: READ_ONLY, brands: READ_ONLY, campaigns: READ_ONLY, placements: READ_ONLY, users: READ_ONLY, creators: READ_ONLY, payouts: READ_ONLY, gdpr: NONE, moderation: NONE, monetization: READ_ONLY, analytics: READ_ONLY, growth: READ_ONLY, moderationQueue: READ_ONLY, trust: READ_ONLY, finance: READ_ONLY, health: NONE, settings: READ_ONLY },
};

export interface RbacDecision {
  allow: boolean;
  // A stable reason code for the audit log and the 403 body. Never leaks the matrix shape.
  reason: "ok" | "unknown_route" | "role_forbidden" | "read_only_violation";
}

// The decision. Compose the route classification, the method read/write split, and the matrix:
//   - unknown route -> deny (unknown_route).
//   - read method -> allow iff the role has read on the surface (else role_forbidden).
//   - write method -> allow iff the role has write on the surface. A role with read-but-not-write that
//     attempts a mutation is a read_only_violation (this is the ReadOnly rule, generalized to every
//     read-scoped role on a mutating method).
export function decide(role: Role, path: string, method: string): RbacDecision {
  const routeKey = classifyRoute(path);
  if (routeKey === "unknown") return { allow: false, reason: "unknown_route" };
  const caps = MATRIX[role][routeKey] ?? NONE;
  if (isReadMethod(method)) {
    return caps.read ? { allow: true, reason: "ok" } : { allow: false, reason: "role_forbidden" };
  }
  if (caps.write) return { allow: true, reason: "ok" };
  // The role can read this surface but not mutate it: the ReadOnly rule. Distinguished from a role that
  // cannot see the surface at all so the audit log records the right denial cause.
  return caps.read
    ? { allow: false, reason: "read_only_violation" }
    : { allow: false, reason: "role_forbidden" };
}

// ---- RBAC read model (GET /admin/settings/roles) ----------------------------------------------------
//
// The roles matrix as a READ MODEL derived directly from the in-code MATRIX above (the single source of
// truth). GET /admin/settings/roles serves this so the console renders the 8 roles x route-capability grid
// WITHOUT re-declaring the policy: the derivation reads the same MATRIX the decide() gate reads, so the
// surfaced grid can never drift from the enforced policy. The route surfaces (RouteKey minus "unknown")
// are the columns; the 8 roles are the rows. There is no write here; this is purely a projection.

export const ROUTE_KEYS: ReadonlyArray<Exclude<RouteKey, "unknown">> = [
  "me",
  "dashboard",
  "content",
  "storyGraph",
  "mediaFactory",
  "accessibility",
  "brands",
  "campaigns",
  "placements",
  "users",
  "creators",
  "payouts",
  "gdpr",
  "moderation",
  "monetization",
  "analytics",
  "growth",
  "moderationQueue",
  "trust",
  "finance",
  "health",
  "settings",
];

// One role's capabilities, route by route. read = may GET; write = may mutate. Mirrors the Caps shape, but
// is a fresh plain object per cell so a consumer cannot mutate the live MATRIX through the read model.
export interface RoleRouteCap {
  route: Exclude<RouteKey, "unknown">;
  read: boolean;
  write: boolean;
}

export interface RoleCapabilities {
  role: Role;
  routes: RoleRouteCap[];
}

// Derive the full role x route capability grid from the live MATRIX. This is the single derivation: it
// reads MATRIX, never a hand-maintained copy, so the read model is always in lock-step with the gate.
export function rolesMatrix(): RoleCapabilities[] {
  return ROLES.map((role) => ({
    role,
    routes: ROUTE_KEYS.map((route) => {
      const caps = MATRIX[role][route] ?? NONE;
      return { route, read: caps.read, write: caps.write };
    }),
  }));
}
