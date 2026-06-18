// Auth at the trust boundary for the online experiment HTTP tier (Slice B). MIRRORS
// services/decision/src/http/auth.ts: identity is resolved from the session bearer token, never from the
// request body. A unit a client smuggles into the body is the bucketing key (not an identity claim), but
// any endpoint that needs an authenticated viewer takes it from the verified session subject.
//
// FLAGGED, NOT FAKED: real token verification (JWT signature, JWKS rotation, issuer/audience, expiry) is
// intentionally NOT implemented here. It lives behind the SessionVerifier interface. The shipped default
// is a TEST verifier (session:<uuid>) suitable for tests and local wiring only. A production deployment
// MUST inject a real verifier. No em dashes.

export interface SessionIdentity {
  userId: string;
}

export interface SessionVerifier {
  verifySession(bearerToken: string | null): Promise<SessionIdentity | null>;
}

// Pull the raw bearer token out of an Authorization header value. Returns null when absent or malformed.
export function parseBearer(authorization: string | null | undefined): string | null {
  if (typeof authorization !== "string") return null;
  const m = /^Bearer (.+)$/.exec(authorization.trim());
  if (m == null) return null;
  const token = m[1].trim();
  return token.length > 0 ? token : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TEST verifier. A token of the form "session:<uuid>" resolves to that uuid. Anything else is
// unauthenticated. No signature check; this is a test verifier, flagged as such.
export function testSessionVerifier(): SessionVerifier {
  return {
    async verifySession(bearerToken) {
      if (bearerToken == null) return null;
      const m = /^session:(.+)$/.exec(bearerToken);
      if (m == null) return null;
      const userId = m[1];
      if (!UUID_RE.test(userId)) return null;
      return { userId };
    },
  };
}
