// Auth at the trust boundary for the companions HTTP adapter. Mirrors
// services/identity-performance/src/http/auth.ts and services/catalog/src/http/auth.ts: the acting identity
// is resolved from the session bearer token, NEVER from the request body or a query string.
//
// This service has TWO subject kinds. Viewer sessions chat with a companion and read companion state; an
// OPERATOR bearer is required for the privileged register (POST /companions) and the irreversible purge
// (POST /revoke/:id), because both create or destroy consented-actor likeness assets.
//
// AGE GATE: a viewer session carries a minor flag, resolved by the verifier from the verified token. The
// service uses it to block minors from mature/romantic companion modes entirely. The flag lives on the
// resolved identity, never trusted from the request body.
//
// FLAGGED, NOT FAKED: real token verification (JWT signature, JWKS rotation, issuer/audience, expiry, the
// real age claim) is intentionally NOT implemented here. It lives behind the verifier interfaces. The
// shipped default is a TEST verifier suitable for tests and local wiring only. A production deployment MUST
// inject real verifiers. The interface is the contract; the test verifier is the stub. No em dashes.

export interface SessionIdentity {
  userId: string;
  // True when the verified subject is a minor. Resolved from the token by a real verifier; the test scheme
  // encodes it. Minors are blocked from mature/romantic companion modes (age gate).
  isMinor: boolean;
}

export interface OperatorIdentity {
  operatorId: string;
}

// Resolve the acting viewer from a session bearer token, or null if missing/invalid.
export interface SessionVerifier {
  verifySession(bearerToken: string | null): Promise<SessionIdentity | null>;
}

// Resolve a privileged operator from an operator bearer token, or null if missing/invalid. Gates the
// register and purge paths (creating / destroying consented-actor likeness assets).
export interface OperatorVerifier {
  verifyOperator(bearerToken: string | null): Promise<OperatorIdentity | null>;
}

export interface Verifiers {
  session: SessionVerifier;
  operator: OperatorVerifier;
}

// Pull the raw bearer token out of an Authorization header value. Returns null when absent or malformed, so
// the verifier receives a clean "no credential" signal rather than a half-parsed string.
export function parseBearer(authorization: string | null | undefined): string | null {
  if (typeof authorization !== "string") return null;
  const m = /^Bearer (.+)$/.exec(authorization.trim());
  if (m == null) return null;
  const token = m[1].trim();
  return token.length > 0 ? token : null;
}

// ---------------------------------------------------------------------------------------------------
// TEST verifiers. Deterministic and offline stubs standing in for real JWT/JWKS verification.
//
// Session scheme:  "session:<uuid>"        resolves to that uuid as an adult acting subject.
//                  "session:<uuid>:minor"  resolves to that uuid as a MINOR acting subject (age gate).
// Operator scheme: "operator:<uuid>"       resolves to that uuid as the acting operator.
// Anything else (or no token) is unauthenticated -> null -> 401. No signature check; flagged as a stub.
// ---------------------------------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function testSessionVerifier(): SessionVerifier {
  return {
    async verifySession(bearerToken) {
      if (bearerToken == null) return null;
      const m = /^session:([^:]+)(?::(minor))?$/.exec(bearerToken);
      if (m == null) return null;
      const userId = m[1];
      if (!UUID_RE.test(userId)) return null;
      return { userId, isMinor: m[2] === "minor" };
    },
  };
}

export function testOperatorVerifier(): OperatorVerifier {
  return {
    async verifyOperator(bearerToken) {
      if (bearerToken == null) return null;
      const m = /^operator:(.+)$/.exec(bearerToken);
      if (m == null) return null;
      const operatorId = m[1];
      if (!UUID_RE.test(operatorId)) return null;
      return { operatorId };
    },
  };
}

export function testVerifiers(): Verifiers {
  return {
    session: testSessionVerifier(),
    operator: testOperatorVerifier(),
  };
}
