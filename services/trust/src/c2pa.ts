// C2PA provenance manifest, TEST SIGNER ONLY.
//
// CRITICAL KEY GATE: this is NOT a real C2PA implementation. Real C2PA signing requires X.509
// certificates from a recognized trust list and private keys held in a KMS / HSM. Both are OUT OF
// SCOPE for this first cut and gated behind a human STOP gate (see AGENTS/W9_trust.md, "Flag, do not
// fake"). Here we use a symmetric HMAC over a canonical manifest with a hard-coded TEST key, purely so
// the persistence path, the not-null provenance link, and verification can be exercised end to end.
// Swapping this module for a KMS-backed cose-sign1 / c2pa-node signer is the production cutover.
//
// No em dashes.

import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalize } from "./canonical.js";

// DO NOT USE IN PRODUCTION. A real deployment must replace this with a KMS-held private key.
const TEST_SIGNING_KEY = "axessplayer-trust-TEST-signer-do-not-use-in-prod";
export const TEST_SIGNER_LABEL = "test-hmac-signer-v0";

export interface C2paClaim {
  // What the manifest asserts about the variant.
  beat_variant_id: string;
  tier: string; // A_filmed | B_likeness | C_ai
  generator: string; // tool / model that produced the asset (e.g. "W8/generation")
  asset_hash: string; // hash of the rendered asset bytes, supplied by the producer
  created_at: string; // ISO timestamp asserted by the producer
}

export interface SignedC2paManifest extends C2paClaim {
  signer: string; // which signer produced the signature
  signature: string; // hex HMAC over the canonical claim (TEST signer)
}

function signClaim(claim: C2paClaim): string {
  return createHmac("sha256", TEST_SIGNING_KEY).update(canonicalize(claim)).digest("hex");
}

// Produce a signed manifest with the TEST signer. In production this call is a KMS sign operation.
export function signManifest(claim: C2paClaim): SignedC2paManifest {
  return { ...claim, signer: TEST_SIGNER_LABEL, signature: signClaim(claim) };
}

// Verify the TEST signature. Returns false on any tamper or unknown signer.
export function verifyManifest(manifest: SignedC2paManifest): boolean {
  if (manifest.signer !== TEST_SIGNER_LABEL) return false;
  const { signer: _signer, signature, ...claim } = manifest;
  const expected = signClaim(claim);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature ?? "", "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
