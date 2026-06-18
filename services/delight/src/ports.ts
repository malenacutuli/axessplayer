// Interface ports the DELIGHT service depends on, reused by INTERFACE ONLY (never by importing a live
// service). Each port has a test stub so the contract is exercisable offline; production injects a real
// client. Shapes mirror the live services (auth from services/ingestion/jobApi.ts, the economy debit from
// services/economy, the decision branch from services/decision) without importing them. No em dashes.

// ---- auth (session bearer; identity from the token, never the body; F1 trust boundary) ----
export interface SessionIdentity {
  userId: string;
}
export interface SessionVerifier {
  verifySession(bearerToken: string | null): Promise<SessionIdentity | null>;
}
export function parseBearer(authorization: string | null | undefined): string | null {
  if (typeof authorization !== "string") return null;
  const m = /^Bearer (.+)$/.exec(authorization.trim());
  if (m == null) return null;
  const token = m[1].trim();
  return token.length > 0 ? token : null;
}
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The TEST session verifier (mirrors decision/economy/adaptation). Accepts session:<uuid>. Production
// refuses it (cutover gate in httpServer.ts) and a real JWKS-backed verifier is injected.
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

// ---- age gate (identity plane by interface) ----
// The viewer age class is resolved from the identity plane, NEVER trusted from the client body. A minor is
// BLOCKED from a mature/romantic inbox thread (HARD gate, server-enforced).
export type AgeClass = "minor" | "adult" | "unknown";
export interface AgeGate {
  ageClassOf(userId: string): Promise<AgeClass>;
}
// Test stub: any userId starting with the minor sentinel (first nibble 0) is a minor; otherwise adult.
// Production injects an identity-plane-backed gate. The default conservatively treats unknown as a minor at
// the call site (the service blocks unknown from mature too).
export function testAgeGate(minorUserIds: ReadonlySet<string> = new Set()): AgeGate {
  return {
    async ageClassOf(userId) {
      return minorUserIds.has(userId) ? "minor" : "adult";
    },
  };
}

// ---- economy debit (services/economy by interface) ----
// The paid clue debits credits server-side. The real call is the hardened spend_coins RPC behind
// services/economy; here it is a port. debit is idempotent on clientTxnId (the economy plane dedupes), and
// throws an Error whose message contains insufficient_funds on a paywall.
export interface EconomyDebit {
  debit(userId: string, amount: number, clientTxnId: string): Promise<{ balance: number }>;
}
export function testEconomyDebit(opts: { startingBalance?: number } = {}): EconomyDebit {
  let balance = opts.startingBalance ?? 100;
  const seen = new Map<string, number>(); // clientTxnId -> balance snapshot at first apply (idempotency)
  return {
    async debit(_userId, amount, clientTxnId) {
      const prior = seen.get(clientTxnId);
      if (prior != null) return { balance: prior }; // idempotent replay: no second debit
      if (balance < amount) throw new Error("insufficient_funds");
      balance -= amount;
      seen.set(clientTxnId, balance);
      return { balance };
    },
  };
}

// ---- decision plane: apply a branch (services/decision by interface) ----
// "choose what I do next" and an unlocked quest both apply a branch to the viewer's session via the
// decision plane. The service does NOT compute the bandit; it asks the decision plane to apply the chosen
// branch and reports the next variant the plane returns.
export interface DecisionPlane {
  applyBranch(input: { userId: string; branchId: string }): Promise<{ nextVariantId: string }>;
}
export function testDecisionPlane(): DecisionPlane {
  return {
    async applyBranch({ branchId }) {
      return { nextVariantId: `variant:${branchId}` };
    },
  };
}

// ---- consent ledger (services/trust by interface) ----
// A message is grounded in a CONSENTED actor. The ledger is owned by services/trust; here a stub treats any
// consent_ref starting with "consent-revoked:" as revoked. A message tied to a revoked/absent consent_ref is
// unreachable.
export interface ConsentLedger {
  isCurrent(consentRef: string | null | undefined): Promise<boolean>;
}
export function testConsentLedger(): ConsentLedger {
  return {
    async isCurrent(consentRef) {
      if (typeof consentRef !== "string" || consentRef.length === 0) return false;
      return !consentRef.startsWith("consent-revoked:");
    },
  };
}

// ---- C2PA signer (synthetic-audio provenance, by interface) ----
// Synthetic audio (a voice note) is C2PA-signed. The signer returns an opaque signature reference stamped
// onto the message. Production injects a real signing-plane client.
export interface C2paSigner {
  sign(audioUrl: string): Promise<{ c2paRef: string }>;
}
export function testC2paSigner(): C2paSigner {
  return {
    async sign(audioUrl) {
      return { c2paRef: `c2pa:test:${Buffer.from(audioUrl).toString("base64url").slice(0, 16)}` };
    },
  };
}
