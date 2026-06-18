// Auth at the trust boundary for the identity HTTP adapter. Two distinct credential kinds meet here:
//
//   1. A Supabase Auth ACCESS TOKEN (a JWT) presented to POST /auth/verify. This is the first contact:
//      the client has signed in with Supabase Auth and exchanges that JWT for an Axessplayer profile. We
//      verify the JWT signature, then extract the auth user id (sub) and email. Verification lives behind
//      the injectable AuthTokenVerifier interface so tests use a deterministic stub while production
//      injects a real JWKS/HS256-backed verifier. FLAGGED, NOT FAKED: the shipped default is a TEST
//      verifier; a production deployment MUST inject a real one (see selectAuthVerifier in server.ts).
//
//   2. A SESSION BEARER TOKEN ("session:<uuid>") presented to the authenticated profile/consent routes.
//      This mirrors services/decision/src/http/auth.ts exactly: the acting viewer is the session subject,
//      never a body field. The shipped default is the same TEST scheme; real signature verification
//      belongs in an injected SessionVerifier. No em dashes.

// ---------------------------------------------------------------------------------------------------
// Session bearer (mirrors services/decision/src/http/auth.ts)
// ---------------------------------------------------------------------------------------------------

export interface SessionIdentity {
  userId: string;
}

// Resolve the acting viewer from a session bearer token, or null if the token is missing or invalid.
// Returning null is how the adapter produces a 401: identity could not be established.
export interface SessionVerifier {
  verifySession(bearerToken: string | null): Promise<SessionIdentity | null>;
}

// ---------------------------------------------------------------------------------------------------
// Supabase Auth access token (the JWT exchanged at POST /auth/verify)
// ---------------------------------------------------------------------------------------------------

// The verified subject of a Supabase Auth access token. authId is the Supabase Auth user id (the JWT
// `sub`); email is the verified email claim. Anything beyond this is not trusted by the linker.
export interface AuthSubject {
  authId: string;
  email: string;
}

// Verify a Supabase Auth access token (JWT). Returns the subject, or null when the token is absent,
// malformed, badly signed, expired, or missing the required claims. The implementation is injected so the
// signature/JWKS verification is a swappable concern: tests inject a stub, production a real verifier.
export interface AuthTokenVerifier {
  verifyAccessToken(token: string | null): Promise<AuthSubject | null>;
}

export interface Verifiers {
  session: SessionVerifier;
  auth: AuthTokenVerifier;
}

// Pull the raw bearer token out of an Authorization header value. Returns null when absent or malformed,
// so the verifier receives a clean "no credential" signal rather than a half-parsed string. Mirrors
// services/decision/src/http/auth.ts.
export function parseBearer(authorization: string | null | undefined): string | null {
  if (typeof authorization !== "string") return null;
  const m = /^Bearer (.+)$/.exec(authorization.trim());
  if (m == null) return null;
  const token = m[1].trim();
  return token.length > 0 ? token : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------------------------------
// TEST verifiers. Deterministic, offline stand-ins for real JWT/JWKS verification. Flagged as such.
// ---------------------------------------------------------------------------------------------------

// Session test scheme: a token of the form "session:<uuid>" resolves to that uuid as the acting viewer.
// Anything else (or no token) is unauthenticated -> null -> 401. Mirrors decision's testSessionVerifier.
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

// Auth-token test scheme: a token of the form "supabase:<authId>:<email>" resolves to that subject. There
// is NO signature check; this is a test verifier, flagged as such. Real JWT signature/JWKS/issuer/audience
// /expiry verification belongs in an injected AuthTokenVerifier (production wires jose/JWKS or HS256).
export function testAuthTokenVerifier(): AuthTokenVerifier {
  return {
    async verifyAccessToken(token) {
      if (token == null) return null;
      const m = /^supabase:([^:]+):(.+)$/.exec(token);
      if (m == null) return null;
      const authId = m[1].trim();
      const email = m[2].trim();
      if (authId.length === 0 || email.length === 0) return null;
      return { authId, email };
    },
  };
}

export function testVerifiers(): Verifiers {
  return {
    session: testSessionVerifier(),
    auth: testAuthTokenVerifier(),
  };
}
