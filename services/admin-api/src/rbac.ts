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
  | "unknown";

// Classify a request path into a policy RouteKey. Trailing-slash and id-suffix tolerant. An unrecognized
// path is "unknown", which the matrix denies for every role. story-graph covers the GET read and its
// validate/simulate POST sub-paths (the constraint solver and the journey walker are pure but are POSTs,
// so they resolve through the storyGraph write capability and are audit-logged as mutation seams).
export function classifyRoute(path: string): RouteKey {
  const clean = path.replace(/\/+$/, "");
  if (clean === "/admin/me") return "me";
  if (clean === "/admin/dashboard") return "dashboard";
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
const MATRIX: Record<Role, Record<Exclude<RouteKey, "unknown">, Caps>> = {
  Owner: { me: ALL, dashboard: ALL, content: ALL, storyGraph: ALL, mediaFactory: ALL, accessibility: ALL, brands: ALL, campaigns: ALL, placements: ALL, users: ALL, creators: ALL, payouts: ALL, gdpr: ALL, moderation: ALL },
  Admin: { me: ALL, dashboard: ALL, content: ALL, storyGraph: ALL, mediaFactory: ALL, accessibility: ALL, brands: ALL, campaigns: ALL, placements: ALL, users: ALL, creators: ALL, payouts: ALL, gdpr: ALL, moderation: ALL },
  Content: { me: READ_ONLY, dashboard: READ_ONLY, content: ALL, storyGraph: ALL, mediaFactory: ALL, accessibility: ALL, brands: READ_ONLY, campaigns: READ_ONLY, placements: READ_ONLY, users: READ_ONLY, creators: READ_ONLY, payouts: READ_ONLY, gdpr: NONE, moderation: NONE },
  Finance: { me: READ_ONLY, dashboard: READ_ONLY, content: READ_ONLY, storyGraph: READ_ONLY, mediaFactory: READ_ONLY, accessibility: READ_ONLY, brands: READ_ONLY, campaigns: READ_ONLY, placements: READ_ONLY, users: READ_ONLY, creators: READ_ONLY, payouts: ALL, gdpr: NONE, moderation: ALL },
  Marketing: { me: READ_ONLY, dashboard: READ_ONLY, content: READ_ONLY, storyGraph: READ_ONLY, mediaFactory: READ_ONLY, accessibility: READ_ONLY, brands: ALL, campaigns: ALL, placements: ALL, users: READ_ONLY, creators: READ_ONLY, payouts: READ_ONLY, gdpr: NONE, moderation: NONE },
  Moderation: { me: READ_ONLY, dashboard: READ_ONLY, content: READ_ONLY, storyGraph: READ_ONLY, mediaFactory: READ_ONLY, accessibility: READ_ONLY, brands: READ_ONLY, campaigns: READ_ONLY, placements: READ_ONLY, users: READ_ONLY, creators: READ_ONLY, payouts: READ_ONLY, gdpr: NONE, moderation: ALL },
  Support: { me: READ_ONLY, dashboard: READ_ONLY, content: READ_ONLY, storyGraph: READ_ONLY, mediaFactory: READ_ONLY, accessibility: READ_ONLY, brands: READ_ONLY, campaigns: READ_ONLY, placements: READ_ONLY, users: ALL, creators: READ_ONLY, payouts: READ_ONLY, gdpr: NONE, moderation: NONE },
  ReadOnly: { me: READ_ONLY, dashboard: READ_ONLY, content: READ_ONLY, storyGraph: READ_ONLY, mediaFactory: READ_ONLY, accessibility: READ_ONLY, brands: READ_ONLY, campaigns: READ_ONLY, placements: READ_ONLY, users: READ_ONLY, creators: READ_ONLY, payouts: READ_ONLY, gdpr: NONE, moderation: NONE },
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
