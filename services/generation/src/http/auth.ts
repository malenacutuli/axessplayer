// Auth at the trust boundary for the generation HTTP adapter. Generation endpoints (enroll references, run a
// generation, read the attempt log) are authed: the acting creator/operator is resolved from the session
// bearer token, exactly as the other services resolve identity.
//
// FLAGGED, NOT FAKED: real token verification (JWT signature, JWKS rotation, issuer/audience, expiry) is NOT
// implemented here. It lives behind the SessionVerifier interface. The shipped default is a TEST verifier
// suitable for QA-grade auth and local wiring only. A production deployment MUST inject a real verifier.
// Mirrors services/recap/src/http/auth.ts. No em dashes.

export interface SessionIdentity {
  userId: string;
}

export interface SessionVerifier {
  verifySession(bearerToken: string | null): Promise<SessionIdentity | null>;
}

export interface Verifiers {
  session: SessionVerifier;
}

export function parseBearer(authorization: string | null | undefined): string | null {
  if (typeof authorization !== "string") return null;
  const m = /^Bearer (.+)$/.exec(authorization.trim());
  if (m == null) return null;
  const token = m[1].trim();
  return token.length > 0 ? token : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TEST verifier. A token "session:<uuid>" resolves to that uuid. Anything else is unauthenticated -> 401.
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
