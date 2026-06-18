// Auth at the trust boundary for the catalog HTTP adapter. Mirrors services/decision/src/http/auth.ts:
// identity is resolved from the session bearer token, never from the request body or a query string. The
// authed endpoints (POST /calibrate, GET /continue) decide and read FOR the verified session subject only.
//
// FLAGGED, NOT FAKED: real token verification (JWT signature, JWKS rotation, issuer/audience, expiry) is
// intentionally NOT implemented here. It lives behind the SessionVerifier interface. The shipped default
// is a TEST verifier (testSessionVerifier) suitable for tests and local wiring only. A production
// deployment MUST inject a real verifier (for example a jose/JWKS-backed one). The interface is the
// contract; the test verifier is the stub. No em dashes.

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

// Pull the raw bearer token out of an Authorization header value. Returns null when absent or malformed,
// so the verifier receives a clean "no credential" signal rather than a half-parsed string.
export function parseBearer(authorization: string | null | undefined): string | null {
  if (typeof authorization !== "string") return null;
  const m = /^Bearer (.+)$/.exec(authorization.trim());
  if (m == null) return null;
  const token = m[1].trim();
  return token.length > 0 ? token : null;
}

// ---------------------------------------------------------------------------------------------------
// TEST verifier. A stub stand-in for real JWT/JWKS verification. Deterministic and offline.
//
// Session test scheme: a token of the form "session:<uuid>" resolves to that uuid as the acting viewer.
//   Anything else (or no token) is unauthenticated -> null -> 401. There is no signature check; this is a
//   test verifier, flagged as such. Real verification belongs in an injected SessionVerifier.
// ---------------------------------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  return {
    session: testSessionVerifier(),
  };
}
