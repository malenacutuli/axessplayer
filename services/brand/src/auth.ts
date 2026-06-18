// Auth at the trust boundary for the brand HTTP adapter. Mirrors services/economy/src/http/auth.ts. Two
// narrow capabilities:
//
//   AdvertiserVerifier -> resolves the acting advertiser (brand/agency) from a session bearer token. This
//                         subject owns the campaigns it may CRUD.
//   OperatorVerifier   -> answers one yes/no: is this caller a trusted operator? Operators approve accounts/
//                         campaigns and run programmatic fills.
//
// FLAGGED, NOT FAKED: real token verification (JWT signature, JWKS rotation, issuer/audience, expiry) is
// intentionally NOT implemented here. The shipped default is a TEST verifier suitable for tests and local
// wiring only. Production MUST inject a real verifier; the production cutover-gate refuses the test verifier
// under NODE_ENV=production. No em dashes.

export interface AdvertiserIdentity {
  advertiserId: string;
}

export interface AdvertiserVerifier {
  verifyAdvertiser(bearerToken: string | null): Promise<AdvertiserIdentity | null>;
}

export interface OperatorVerifier {
  verifyOperator(bearerToken: string | null): Promise<boolean>;
}

export interface Verifiers {
  advertiser: AdvertiserVerifier;
  operator: OperatorVerifier;
}

export function parseBearer(authorization: string | null | undefined): string | null {
  if (typeof authorization !== "string") return null;
  const m = /^Bearer (.+)$/.exec(authorization.trim());
  if (m == null) return null;
  const token = m[1].trim();
  return token.length > 0 ? token : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TEST advertiser scheme: "advertiser:<uuid>" resolves to that uuid. No signature check (flagged test stub).
export function testAdvertiserVerifier(): AdvertiserVerifier {
  return {
    async verifyAdvertiser(bearerToken) {
      if (bearerToken == null) return null;
      const m = /^advertiser:(.+)$/.exec(bearerToken);
      if (m == null) return null;
      const advertiserId = m[1];
      if (!UUID_RE.test(advertiserId)) return null;
      return { advertiserId };
    },
  };
}

// TEST operator scheme: the single secret passed in is the operator role; anything else is not.
export function testOperatorVerifier(operatorSecret: string): OperatorVerifier {
  if (typeof operatorSecret !== "string" || operatorSecret.length === 0) {
    throw new Error("testOperatorVerifier requires a non-empty operator secret");
  }
  return {
    async verifyOperator(bearerToken) {
      return bearerToken != null && bearerToken === operatorSecret;
    },
  };
}

export function testVerifiers(operatorSecret: string): Verifiers {
  return {
    advertiser: testAdvertiserVerifier(),
    operator: testOperatorVerifier(operatorSecret),
  };
}
