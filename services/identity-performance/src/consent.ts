// Consent gate for the identity-performance service. CONSENT (hard gate, ties to P8): any real-likeness
// identity asset requires a CURRENT consent-ledger entry as the render precondition. The CANONICAL system of
// record is the tamper-evident consent chain owned by services/trust (the consent_ledger table). This service
// does NOT own that table and MUST NOT write a migration or SQL for it; it reads consent STATE through this
// narrow port.
//
// The port answers one question for a given consent_ref: is consent CURRENT (granted and not revoked)? A
// real-likeness operation (register with biometric references, lipsync, deage, any drift score over real
// references) is refused when the answer is no. Revocation flips the answer to false AND triggers the purge
// path in the store (hard-delete of the identity asset and its derived shots).
//
// This file defines the ConsentGate port and ships an in-memory stub. Production wiring routes lookups to
// services/trust over HTTP. The stub lets the routes, the auth boundary, and the tests exercise the full
// request path today without coupling to trust's internals or fabricating a schema. No em dashes.

export interface ConsentState {
  // True only when the subject's consent for this ref is granted AND has not been revoked. A real-likeness
  // render precondition checks exactly this.
  current: boolean;
}

// The port the routes depend on. Injection keeps the routes testable and lets production swap the stub for a
// trust-backed client without touching the routes.
export interface ConsentGate {
  // Resolve the consent state for a consent_ref. A null/empty ref is treated as NOT current: an identity with
  // no consent reference can never be real-likeness rendered.
  status(consentRef: string | null | undefined): Promise<ConsentState>;
}

// In-memory stub. Tracks which consent refs are currently granted so a test can grant, then revoke, and
// observe the gate close. A ref that was never granted is NOT current (default-deny).
//
// TODO(trust-wiring): replace with a client that reads services/trust's consent chain so currency reflects
// the tamper-evident ledger. Do NOT write a migration or SQL from this service; trust owns that table.
export class InMemoryConsentGate implements ConsentGate {
  private readonly granted = new Set<string>();

  grant(consentRef: string): void {
    this.granted.add(consentRef);
  }

  // Revoke at the consent layer. The store purge path is invoked separately by the route so the gate stays a
  // pure consent oracle.
  revoke(consentRef: string): void {
    this.granted.delete(consentRef);
  }

  async status(consentRef: string | null | undefined): Promise<ConsentState> {
    if (consentRef == null || consentRef.length === 0) return { current: false };
    return { current: this.granted.has(consentRef) };
  }
}
