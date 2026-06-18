// Provenance for companion turns. PROVENANCE (hard gate, prompt 16): EVERY synthetic companion turn is
// C2PA-signed and EU AI Act Article-50 labeled as AI-generated. A synthetic turn that is not signed and not
// labeled is INVALID and is never persisted or returned.
//
// CRITICAL KEY GATE (mirrors services/trust/src/c2pa.ts): this is NOT a real C2PA implementation. Real C2PA
// signing requires X.509 certificates from a recognized trust list and private keys held in a KMS / HSM.
// Both are OUT OF SCOPE for this cut and gated behind a human STOP gate. Here a symmetric HMAC over a
// canonical claim with a hard-coded TEST key stands in, purely so the persistence path, the not-null
// provenance link, and verification can be exercised end to end. Swapping this module for a KMS-backed
// cose-sign1 / c2pa-node signer is the production cutover. No em dashes.

import { createHmac, timingSafeEqual } from "node:crypto";

// DO NOT USE IN PRODUCTION. A real deployment must replace this with a KMS-held private key.
const TEST_SIGNING_KEY = "axessplayer-companions-TEST-signer-do-not-use-in-prod";
export const TEST_SIGNER_LABEL = "test-hmac-signer-v0";

// The persistent EU AI Act Article-50 disclosure attached to every synthetic turn. The product also shows a
// persistent on-screen "this is an AI character" disclosure; this is the machine-readable label.
export const AI_LABEL = "ai-generated:article-50";

export interface TurnClaim {
  // What the manifest asserts about the synthetic turn.
  session_id: string;
  companion_id: string;
  // The turn content the signature binds to. A swapped message body breaks the signature.
  content: string;
  // The model id that produced the turn (from the router result; never a hardcoded vendor).
  model: string;
  created_at: string; // ISO timestamp asserted by the producer
}

export interface SignedTurnManifest extends TurnClaim {
  signer: string; // which signer produced the signature
  signature: string; // hex HMAC over the canonical claim (TEST signer)
  ai_label: string; // Article-50 AI-generated label, always present on a synthetic turn
}

// Deterministic canonical encoding of the claim (stable key order) so the signature is reproducible. Mirrors
// the intent of services/trust/src/canonical.ts without importing across services.
function canonicalize(claim: TurnClaim): string {
  return JSON.stringify({
    companion_id: claim.companion_id,
    content: claim.content,
    created_at: claim.created_at,
    model: claim.model,
    session_id: claim.session_id,
  });
}

function signClaim(claim: TurnClaim): string {
  return createHmac("sha256", TEST_SIGNING_KEY).update(canonicalize(claim)).digest("hex");
}

// Produce a signed + labeled manifest with the TEST signer. In production this call is a KMS sign operation.
// The Article-50 label is attached unconditionally: a synthetic turn is always disclosed as AI-generated.
export function signTurn(claim: TurnClaim): SignedTurnManifest {
  return { ...claim, signer: TEST_SIGNER_LABEL, signature: signClaim(claim), ai_label: AI_LABEL };
}

// Verify the TEST signature AND that the Article-50 label is present. Returns false on any tamper, unknown
// signer, or a missing label (an unlabeled synthetic turn fails provenance).
export function verifyTurn(manifest: SignedTurnManifest): boolean {
  if (manifest.signer !== TEST_SIGNER_LABEL) return false;
  if (manifest.ai_label !== AI_LABEL) return false;
  const { signer: _signer, signature, ai_label: _label, ...claim } = manifest;
  const expected = signClaim(claim);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature ?? "", "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
