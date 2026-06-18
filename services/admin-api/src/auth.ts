// Operator auth at the trust boundary for the admin API. The acting operator is resolved from a Bearer
// operator-token, never from a request body or query param. The verifier returns { operatorId, role } or
// null; null is how the adapter produces a 401.
//
// FLAGGED, NOT FAKED: real operator authentication (SSO/email login, MFA, a signed JWT verified against a
// JWKS endpoint, issuer/audience/expiry checks) is intentionally NOT implemented here. It lives behind
// the OperatorVerifier interface. The shipped default is a TEST verifier (testOperatorVerifier) for tests
// and local wiring only. A production deployment MUST inject a real verifier; the served entry refuses to
// start the test verifier under NODE_ENV=production (the cutover gate). The interface is the contract;
// the test verifier is the stub. No em dashes.

import { isRole, type Role } from "./rbac.js";

export interface OperatorIdentity {
  operatorId: string;
  role: Role;
}

// Resolve the acting operator from a Bearer token, or null if the token is missing or invalid. Returning
// null is how the adapter produces a 401: identity could not be established.
export interface OperatorVerifier {
  verify(bearerToken: string | null): Promise<OperatorIdentity | null>;
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
// TEST verifier. A deterministic, offline stand-in for real operator JWT/JWKS verification.
//
// Test scheme: a token of the form "operator:<role>:<id>" resolves to { operatorId: id, role } when the
// role is one of the 8 known roles. Anything else (or no token) is unauthenticated -> null -> 401. There
// is no signature check; this is a test verifier, flagged as such. Real verification belongs in an
// injected OperatorVerifier.
// ---------------------------------------------------------------------------------------------------

export function testOperatorVerifier(): OperatorVerifier {
  return {
    async verify(bearerToken) {
      if (bearerToken == null) return null;
      const m = /^operator:([^:]+):(.+)$/.exec(bearerToken);
      if (m == null) return null;
      const role = m[1];
      const operatorId = m[2];
      if (!isRole(role)) return null;
      if (operatorId.trim().length === 0) return null;
      return { operatorId, role };
    },
  };
}
