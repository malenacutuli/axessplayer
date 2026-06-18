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
const MATRIX: Record<Role, Record<Exclude<RouteKey, "unknown">, Caps>> = {
  Owner: { me: ALL, dashboard: ALL, content: ALL, storyGraph: ALL, mediaFactory: ALL, accessibility: ALL },
  Admin: { me: ALL, dashboard: ALL, content: ALL, storyGraph: ALL, mediaFactory: ALL, accessibility: ALL },
  Content: { me: READ_ONLY, dashboard: READ_ONLY, content: ALL, storyGraph: ALL, mediaFactory: ALL, accessibility: ALL },
  Finance: { me: READ_ONLY, dashboard: READ_ONLY, content: READ_ONLY, storyGraph: READ_ONLY, mediaFactory: READ_ONLY, accessibility: READ_ONLY },
  Marketing: { me: READ_ONLY, dashboard: READ_ONLY, content: READ_ONLY, storyGraph: READ_ONLY, mediaFactory: READ_ONLY, accessibility: READ_ONLY },
  Moderation: { me: READ_ONLY, dashboard: READ_ONLY, content: READ_ONLY, storyGraph: READ_ONLY, mediaFactory: READ_ONLY, accessibility: READ_ONLY },
  Support: { me: READ_ONLY, dashboard: READ_ONLY, content: READ_ONLY, storyGraph: READ_ONLY, mediaFactory: READ_ONLY, accessibility: READ_ONLY },
  ReadOnly: { me: READ_ONLY, dashboard: READ_ONLY, content: READ_ONLY, storyGraph: READ_ONLY, mediaFactory: READ_ONLY, accessibility: READ_ONLY },
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
