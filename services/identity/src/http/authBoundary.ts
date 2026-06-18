// C12 auth boundary: classify each identity route as anonymous-allowed or auth-required. The map is
// surface behavior straight out of docs/product/design/INTERACTION_MAP.md: browsing the feed is anonymous,
// but anything that writes a viewer's profile, consent, wallet, save, or download is gated behind a valid
// session. A protected op presented without a valid session answers 401 { error: "sign_in_required" }.
//
// This module is pure (no Hono, no Postgres) so it is unit-testable in isolation and reusable by any
// adapter. The classifier keys on (method, path) and returns whether a session is required. Unknown routes
// default to AUTH-REQUIRED (fail closed): a route we did not explicitly mark anonymous must not leak.
// No em dashes.

export type AuthRequirement = "anonymous" | "session";

export interface RouteRule {
  method: string;
  // Matched against the request path. A trailing "/*" marks a prefix match (e.g. feed sub-paths).
  pattern: string;
  requirement: AuthRequirement;
}

// The C12 boundary table for the identity service. Anonymous-allowed routes are the unauthenticated first
// contact (verify a Supabase token, check username availability) plus feed browse. Everything that mutates
// or reads a specific viewer's sovereign state requires a session.
export const IDENTITY_ROUTE_RULES: readonly RouteRule[] = [
  // Anonymous-allowed: first contact and pre-auth checks.
  { method: "POST", pattern: "/auth/verify", requirement: "anonymous" },
  { method: "GET", pattern: "/profile/username-available", requirement: "anonymous" },
  { method: "GET", pattern: "/health", requirement: "anonymous" },
  // Anonymous-allowed: feed browse (C12 explicitly allows un-signed-in browsing).
  { method: "GET", pattern: "/feed", requirement: "anonymous" },
  { method: "GET", pattern: "/feed/*", requirement: "anonymous" },
  // Auth-required: wallet / save / download / consent / profile writes and the session subject's profile.
  { method: "POST", pattern: "/profile", requirement: "session" },
  { method: "GET", pattern: "/me", requirement: "session" },
  { method: "POST", pattern: "/consent", requirement: "session" },
];

// Strip the query string and any trailing slash (except root) so the classifier keys on the bare path.
export function normalizePath(rawPath: string): string {
  const q = rawPath.indexOf("?");
  let p = q >= 0 ? rawPath.slice(0, q) : rawPath;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function ruleMatches(rule: RouteRule, method: string, path: string): boolean {
  if (rule.method.toUpperCase() !== method.toUpperCase()) return false;
  if (rule.pattern.endsWith("/*")) {
    const prefix = rule.pattern.slice(0, -2);
    return path === prefix || path.startsWith(prefix + "/");
  }
  return rule.pattern === path;
}

// Classify a request. Fail closed: an unmatched route is treated as session-required so a new endpoint is
// never accidentally anonymous. Exact-match rules win over prefix ("/*") rules when both could match.
export function classifyRoute(
  method: string,
  rawPath: string,
  rules: readonly RouteRule[] = IDENTITY_ROUTE_RULES,
): AuthRequirement {
  const path = normalizePath(rawPath);
  let prefixHit: AuthRequirement | null = null;
  for (const rule of rules) {
    if (!ruleMatches(rule, method, path)) continue;
    if (rule.pattern.endsWith("/*")) {
      prefixHit = rule.requirement;
    } else {
      return rule.requirement;
    }
  }
  if (prefixHit != null) return prefixHit;
  return "session";
}

// Convenience predicate used by the adapter middleware.
export function requiresSession(
  method: string,
  rawPath: string,
  rules: readonly RouteRule[] = IDENTITY_ROUTE_RULES,
): boolean {
  return classifyRoute(method, rawPath, rules) === "session";
}
