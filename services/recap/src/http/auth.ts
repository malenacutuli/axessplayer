// Auth at the trust boundary for the recap HTTP adapter. GET /recap/:seriesId is authed: the acting viewer
// is resolved from the session bearer token, exactly as the decision and economy adapters resolve identity.
// The viewer_state read is scoped to the session subject; a client cannot fetch another viewer's recap.
//
// FLAGGED, NOT FAKED: real token verification (JWT signature, JWKS rotation, issuer/audience, expiry) is
// intentionally NOT implemented here. It lives behind the SessionVerifier interface. The shipped default is
// a TEST verifier (testSessionVerifier) suitable for tests and local wiring only. A production deployment
// MUST inject a real verifier. This mirrors services/decision/src/http/auth.ts. No em dashes.

export interface SessionIdentity {
  userId: string;
}

// Resolve the acting viewer from a session bearer token, or null if the token is missing or invalid.
// Returning null is how the adapter produces a 401: identity could not be established.
export interface SessionVerifier {
  verifySession(bearerToken: string | null): Promise<SessionIdentity | null>;
}

export interface Verifiers {
  session: SessionVerifier;
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

// TEST verifier. A token of the form "session:<uuid>" resolves to that uuid as the acting viewer. Anything
// else (or no token) is unauthenticated -> null -> 401. No signature check; flagged as a test verifier.
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

export function testVerifiers(): Verifiers {
  return { session: testSessionVerifier() };
}
