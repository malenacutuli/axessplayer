// Auth at the F1 trust boundary for the economy HTTP adapter. Two distinct, narrow capabilities:
//
//   SessionVerifier  -> resolves the acting user id from an end-user session bearer token (sessionAuth).
//                       This subject is what /wallet and /spend act on. The body never carries a user id.
//   ServiceVerifier  -> answers one yes/no question: is this caller the trusted server role? (serviceAuth).
//                       Only a true answer may reach /grant.
//
// FLAGGED, NOT FAKED: real token verification (JWT signature, JWKS rotation, issuer/audience, expiry) is
// intentionally NOT implemented here. It lives behind these interfaces. The shipped default is a TEST
// verifier (testSessionVerifier / testServiceVerifier) suitable for tests and local wiring only. A
// production deployment MUST inject a real verifier (for example a jose/JWKS-backed one). The interface is
// the contract; the test verifier is the stub. No em dashes.

export interface SessionIdentity {
  userId: string;
}

// Resolve the acting user from a session bearer token, or null if the token is missing or invalid.
// Returning null is how the adapter produces a 401: identity could not be established.
export interface SessionVerifier {
  verifySession(bearerToken: string | null): Promise<SessionIdentity | null>;
}

// Decide whether a caller holds the trusted service role. False produces a 403 on /grant.
export interface ServiceVerifier {
  verifyService(bearerToken: string | null): Promise<boolean>;
}

export interface Verifiers {
  session: SessionVerifier;
  service: ServiceVerifier;
}

// Pull the raw bearer token out of an Authorization header value. Returns null when absent or malformed,
// so the verifiers receive a clean "no credential" signal rather than a half-parsed string.
export function parseBearer(authorization: string | null | undefined): string | null {
  if (typeof authorization !== "string") return null;
  const m = /^Bearer (.+)$/.exec(authorization.trim());
  if (m == null) return null;
  const token = m[1].trim();
  return token.length > 0 ? token : null;
}

// ---------------------------------------------------------------------------------------------------
// TEST verifiers. Stub stand-ins for real JWT/JWKS verification. Deterministic and offline.
//
// Session test scheme: a token of the form "session:<uuid>" resolves to that uuid as the acting user.
//   Anything else (or no token) is unauthenticated -> null -> 401. There is no signature check; this is a
//   test verifier, flagged as such. Real verification belongs in an injected SessionVerifier.
//
// Service test scheme: the single token value passed to testServiceVerifier(secret) is the service role.
//   Any other token (or none) is not the service role -> false -> 403.
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

export function testServiceVerifier(serviceSecret: string): ServiceVerifier {
  if (typeof serviceSecret !== "string" || serviceSecret.length === 0) {
    throw new Error("testServiceVerifier requires a non-empty service secret");
  }
  return {
    async verifyService(bearerToken) {
      // Constant work regardless of input; the value still must match exactly.
      return bearerToken != null && bearerToken === serviceSecret;
    },
  };
}

export function testVerifiers(serviceSecret: string): Verifiers {
  return {
    session: testSessionVerifier(),
    service: testServiceVerifier(serviceSecret),
  };
}
