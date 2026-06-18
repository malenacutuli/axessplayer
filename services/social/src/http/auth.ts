// Auth at the trust boundary for the social HTTP adapter. The acting viewer is the SESSION subject, never
// a body field (the F1 trust boundary, same stance as services/identity and services/decision). All social
// routes are session-authed.
//
// A SESSION BEARER TOKEN ("session:<uuid>") is presented on every route. The shipped default is the TEST
// scheme; real signature verification belongs in an injected SessionVerifier. FLAGGED, NOT FAKED: a
// production deployment MUST inject a real verifier (see selectVerifier in server.ts; NODE_ENV=production
// refuses the test verifier). No em dashes.

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
// Mirrors services/identity/src/http/auth.ts.
export function parseBearer(authorization: string | null | undefined): string | null {
  if (typeof authorization !== "string") return null;
  const m = /^Bearer (.+)$/.exec(authorization.trim());
  if (m == null) return null;
  const token = m[1].trim();
  return token.length > 0 ? token : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Session test scheme: a token of the form "session:<uuid>" resolves to that uuid as the acting viewer.
// Anything else (or no token) is unauthenticated -> null -> 401. Mirrors identity's testSessionVerifier.
// Flagged: NO signature check; real verification belongs in an injected SessionVerifier.
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
