// Unit tests for the TEST C2PA signer. This signer is a stand-in (HMAC, hard-coded test key) and is
// NOT production C2PA. These tests prove the stand-in detects a tampered manifest, which is what the
// verification routine relies on. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { signManifest, verifyManifest, TEST_SIGNER_LABEL, type C2paClaim } from "../src/c2pa.js";

const claim: C2paClaim = {
  beat_variant_id: "cccccccc-0000-0000-0000-000000000001",
  tier: "C_ai",
  generator: "W8/generation",
  asset_hash: "sha256:abc123",
  created_at: "2026-06-15T10:00:00.000Z",
};

test("a freshly signed manifest verifies and is labelled as the test signer", () => {
  const m = signManifest(claim);
  assert.equal(m.signer, TEST_SIGNER_LABEL);
  assert.equal(verifyManifest(m), true);
});

test("tampering with a manifest field fails verification", () => {
  const m = signManifest(claim);
  m.tier = "A_filmed"; // claim changed, signature not refreshed
  assert.equal(verifyManifest(m), false);
});

test("a forged signature fails verification", () => {
  const m = signManifest(claim);
  m.signature = "00".repeat(32);
  assert.equal(verifyManifest(m), false);
});

test("an unknown signer label fails verification", () => {
  const m = signManifest(claim);
  m.signer = "some-other-signer";
  assert.equal(verifyManifest(m), false);
});
