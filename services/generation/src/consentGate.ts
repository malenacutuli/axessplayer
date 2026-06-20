// PROMPT 26 hard gate: a talent-likeness or real-likeness generation requires a CURRENT consent-ledger
// entry (prompt 08). This is the generation-side port; the real implementation is an HTTP client to
// services/trust (which owns the tamper-evident consent_ledger), the fake is for tests. Mirrors the
// ConsentGate port in services/identity-performance so the two services check consent the same way.
//
// Tiering: A_filmed is real footage (no generative consent gate here). C_ai is fully synthetic with no real
// person (no likeness consent needed). B_likeness (and any real-likeness generation) is FENCED: it may run
// only with current consent, and a revocation purges derived assets upstream. No em dashes.

import type { VariantTier } from "./spec.js";

export interface ConsentState {
  current: boolean; // true only when consent was granted AND not revoked
}

export interface ConsentGate {
  status(consentRef: string | null | undefined): Promise<ConsentState>;
}

// In-memory gate for tests and dry runs: a ref is current only if explicitly granted and not revoked.
export class InMemoryConsentGate implements ConsentGate {
  private readonly granted = new Set<string>();
  grant(ref: string): void {
    this.granted.add(ref);
  }
  revoke(ref: string): void {
    this.granted.delete(ref);
  }
  async status(consentRef: string | null | undefined): Promise<ConsentState> {
    return { current: consentRef != null && this.granted.has(consentRef) };
  }
}

export class ConsentBlockedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`likeness generation blocked: ${reason}`);
    this.name = "ConsentBlockedError";
    this.reason = reason;
  }
}

// Whether a tier needs a current consent entry before it may generate. Only B_likeness (real-likeness) is
// fenced; an explicit realLikeness flag also fences (a C_ai job that happens to use a real person's refs).
export function tierNeedsConsent(tier: VariantTier, realLikeness = false): boolean {
  return tier === "B_likeness" || realLikeness;
}

// THE GATE. Throws ConsentBlockedError when a likeness generation lacks current consent. Returns silently
// when the tier needs no consent or consent is current. Call this BEFORE any paid generation for the tier.
export async function guardLikenessConsent(
  gate: ConsentGate,
  tier: VariantTier,
  consentRef: string | null | undefined,
  realLikeness = false,
): Promise<void> {
  if (!tierNeedsConsent(tier, realLikeness)) return;
  if (consentRef == null || consentRef === "") {
    throw new ConsentBlockedError("no_consent_ref");
  }
  const state = await gate.status(consentRef);
  if (!state.current) throw new ConsentBlockedError("consent_not_current");
}
