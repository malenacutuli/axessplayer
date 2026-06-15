// Integration tests for the trust service against the REAL frozen migrations (PGlite + supabase
// migrations + seed). Proves: provenance persists with the enforced NOT NULL variant link; an orphan
// provenance / consent insert is rejected by the database FK; the consent chain appends and verifies;
// a row mutated directly in the database makes verification FAIL; and a variant is not servable without
// provenance. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, FIX } from "./harness.js";
import { PgTrustDb } from "../src/pgTrustDb.js";
import { TrustService, type C2paClaim } from "../src/trust.js";

function claimFor(variantId: string, tier = "C_ai"): C2paClaim {
  return {
    beat_variant_id: variantId,
    tier,
    generator: "W8/generation",
    asset_hash: "sha256:deadbeefcafe",
    created_at: "2026-06-15T09:00:00.000Z",
  };
}

test("provenance persists and links to the variant", async () => {
  const db = await freshDb();
  const svc = new TrustService(new PgTrustDb(db));
  const cred = await svc.recordProvenance(claimFor(FIX.coldOpen));
  assert.equal(cred.beat_variant_id, FIX.coldOpen);
  assert.equal(cred.manifest.signer, "test-hmac-signer-v0");

  const row = await db.query<{ n: number }>(
    "select count(*)::int as n from content_credentials where beat_variant_id = $1",
    [FIX.coldOpen]
  );
  assert.equal(row.rows[0].n, 1, "one credential row persisted");
});

test("the NOT NULL provenance link is enforced: an orphan credential insert is rejected", async () => {
  const db = await freshDb();
  const svc = new TrustService(new PgTrustDb(db));
  await assert.rejects(
    () => svc.recordProvenance(claimFor(FIX.unknownVariant)),
    /foreign key|violates|constraint/i,
    "inserting provenance for a non-existent variant must violate the FK"
  );
});

test("a variant cannot be servable without a provenance record", async () => {
  const db = await freshDb();
  const svc = new TrustService(new PgTrustDb(db));
  const before = await svc.verifyVariant(FIX.coldOpen);
  assert.equal(before.hasProvenance, false);
  assert.equal(before.servable, false);
  assert.match(before.reason ?? "", /no provenance/i);

  await svc.recordProvenance(claimFor(FIX.coldOpen));
  // Provenance alone with an empty consent chain is intact (empty chain verifies), so it becomes servable.
  const after = await svc.verifyVariant(FIX.coldOpen);
  assert.equal(after.hasProvenance, true);
  assert.equal(after.servable, true, after.reason);
});

test("several consent rows append and the chain verifies back to genesis", async () => {
  const db = await freshDb();
  const svc = new TrustService(new PgTrustDb(db));
  await svc.recordProvenance(claimFor(FIX.coldOpen));

  for (let i = 0; i < 4; i++) {
    await svc.appendConsent({
      likeness_subject: `actor-${i}`,
      beat_variant_id: FIX.coldOpen,
      consent_ref: `consent-doc-${i}`,
      royalty_terms: { pct: 5 + i },
    });
  }

  const v = await svc.verifyVariant(FIX.coldOpen);
  assert.equal(v.consentRowCount, 4);
  assert.equal(v.consentChainIntact, true, v.reason);
  assert.equal(v.servable, true, v.reason);

  // The genesis row carries a null prev_hash; later rows do not.
  const genesis = await db.query<{ prev_hash: string | null }>(
    "select prev_hash from consent_ledger where beat_variant_id = $1 order by created_at asc, id asc limit 1",
    [FIX.coldOpen]
  );
  assert.equal(genesis.rows[0].prev_hash, null, "genesis row has a null prev_hash");
});

test("the NOT NULL consent link is enforced: an orphan consent insert is rejected", async () => {
  const db = await freshDb();
  const svc = new TrustService(new PgTrustDb(db));
  await assert.rejects(
    () =>
      svc.appendConsent({
        likeness_subject: "ghost",
        beat_variant_id: FIX.unknownVariant,
        consent_ref: "consent-x",
      }),
    /foreign key|violates|constraint/i,
    "consent for a non-existent variant must violate the FK"
  );
});

test("mutating a stored consent row makes verification FAIL (tamper detection)", async () => {
  const db = await freshDb();
  const svc = new TrustService(new PgTrustDb(db));
  await svc.recordProvenance(claimFor(FIX.coldOpen));

  for (let i = 0; i < 3; i++) {
    await svc.appendConsent({
      likeness_subject: `actor-${i}`,
      beat_variant_id: FIX.coldOpen,
      consent_ref: `consent-doc-${i}`,
      royalty_terms: { pct: 5 + i },
    });
  }

  // Sanity: intact before tamper.
  const intact = await svc.verifyVariant(FIX.coldOpen);
  assert.equal(intact.consentChainIntact, true, intact.reason);

  // Tamper: change the consent_ref of the genesis row directly in the database, leaving its stored
  // row_hash untouched. This is exactly the attack the chain must catch.
  const target = await db.query<{ id: string }>(
    "select id from consent_ledger where beat_variant_id = $1 order by created_at asc, id asc limit 1",
    [FIX.coldOpen]
  );
  await db.query("update consent_ledger set consent_ref = 'FORGED' where id = $1", [target.rows[0].id]);

  const tampered = await svc.verifyVariant(FIX.coldOpen);
  assert.equal(tampered.consentChainIntact, false, "tampered chain must not verify");
  assert.equal(tampered.servable, false, "tampered variant must not be servable");
  assert.match(tampered.reason ?? "", /consent chain broken/i);
});

test("rejects persisting an upstream manifest whose signature does not verify", async () => {
  const db = await freshDb();
  const svc = new TrustService(new PgTrustDb(db));
  const bad = {
    beat_variant_id: FIX.coldOpen,
    tier: "C_ai",
    generator: "W8/generation",
    asset_hash: "sha256:x",
    created_at: "2026-06-15T09:00:00.000Z",
    signer: "test-hmac-signer-v0",
    signature: "00".repeat(32),
  };
  await assert.rejects(() => svc.recordSignedProvenance(bad), /did not verify/i);
});
