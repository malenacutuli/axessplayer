// Consent ledger interface for the identity service. POST /consent records a viewer's consent decision
// (for example data capture / personalization / accessibility-data processing) at the moment of profile
// creation. The CANONICAL system of record is the tamper-evident consent chain owned by services/trust
// (the consent_ledger table, appended via the trust write path). The identity service does NOT own that
// table and MUST NOT write a migration or SQL for it.
//
// So this file defines a small ConsentSink port and ships an in-memory stub. Production wiring routes
// records to services/trust over HTTP. The stub lets the route, the auth boundary, and the tests exercise
// the full request path today without coupling to trust's internals or fabricating a schema.
//
// GATE: no biometric or personal data leaves the sovereign plane. A consent record carries the decision
// metadata (subject, purpose, granted, version, timestamp), NOT the underlying personal/biometric data.
// No em dashes.

export interface ConsentRecord {
  // The session subject (mobile.users.id) whose consent this is. Set by the route from the verified
  // session, never from the request body.
  userId: string;
  // What is being consented to, for example "data_capture", "personalization", "accessibility_profile".
  purpose: string;
  // The viewer's decision. A withdrawal is recorded as granted=false, never deleted (append-only).
  granted: boolean;
  // The policy/version string the viewer agreed to, so a later policy change is auditable.
  policyVersion: string;
  recordedAt: string;
}

export interface ConsentReceipt {
  // The append-only ledger reference. With the real trust wiring this is the chain entry id / consent_ref;
  // the stub returns a synthetic id so callers can echo a receipt.
  consentRef: string;
}

// The port the route depends on. verifySession-style injection keeps the route testable and lets
// production swap the stub for a trust-backed client without touching the route.
export interface ConsentSink {
  record(record: ConsentRecord): Promise<ConsentReceipt>;
}

// In-memory stub. Captures records so a test can assert on them, and returns a synthetic consent_ref.
//
// TODO(trust-wiring): replace with a client that POSTs to services/trust's consent append endpoint so the
// record lands on the tamper-evident hash chain (consent_ledger). Do NOT write a migration or SQL from
// the identity service; the trust service owns that table and its write path. Until then this stub is the
// flagged stopgap, mirroring the "flagged, not faked" stance of the decision/content cutover gates.
export class InMemoryConsentSink implements ConsentSink {
  private readonly entries: ConsentRecord[] = [];

  async record(record: ConsentRecord): Promise<ConsentReceipt> {
    this.entries.push(record);
    const consentRef = `consent-stub:${record.userId}:${this.entries.length}`;
    return { consentRef };
  }

  // Test/inspection helper. Not part of the port.
  all(): readonly ConsentRecord[] {
    return this.entries;
  }
}
