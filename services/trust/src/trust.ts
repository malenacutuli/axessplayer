// Trust service domain: provenance (C2PA) and the consent ledger (hash chain), plus a verification
// routine. The service depends only on the TrustDB interface; pgTrustDb.ts is the real Postgres
// adapter. Mutations are append-only and never trust a client-supplied hash. No em dashes.

import {
  signManifest,
  verifyManifest,
  TEST_SIGNER_LABEL,
  type C2paClaim,
  type SignedC2paManifest,
} from "./c2pa.js";
import {
  computeRowHash,
  verifyChain,
  type ConsentContent,
  type ChainRow,
} from "./hashChain.js";

export interface CredentialRow {
  id: string;
  beat_variant_id: string;
  manifest: SignedC2paManifest;
  tier: string;
}

export interface ConsentInput {
  likeness_subject: string;
  beat_variant_id: string;
  consent_ref: string;
  royalty_terms?: unknown;
}

export interface ConsentRow extends ChainRow {
  id: string;
}

// Persistence port. The adapter owns SQL; the service owns hashing and signing so the hash is never
// taken on trust from the caller.
export interface TrustDB {
  insertCredential(
    beatVariantId: string,
    manifest: SignedC2paManifest,
    tier: string
  ): Promise<CredentialRow>;
  getCredential(beatVariantId: string): Promise<CredentialRow | null>;
  // The current tip (last appended) row of a variant's chain, or null when the chain is empty. Returns
  // both the tip row_hash (to link the next row) and its created_at (so the service can guarantee the
  // next row sorts strictly after it, making the append order deterministic).
  getChainTip(beatVariantId: string): Promise<{ rowHash: string; createdAt: string } | null>;
  insertConsent(
    input: ConsentInput,
    createdAt: string,
    prevHash: string | null,
    rowHash: string
  ): Promise<ConsentRow>;
  // All consent rows for a variant in append order (created_at, then id as a stable tiebreak).
  getConsentChain(beatVariantId: string): Promise<ConsentRow[]>;
}

export interface VerifyResult {
  variantId: string;
  hasProvenance: boolean;
  provenanceSignatureValid: boolean;
  consentChainIntact: boolean;
  consentRowCount: number;
  // True only when provenance exists, its signature verifies, and the consent chain is intact.
  servable: boolean;
  reason?: string;
}

export class TrustService {
  constructor(private readonly db: TrustDB) {}

  // Sign a C2PA claim with the TEST signer and persist it. The NOT NULL beat_variant_id FK is enforced
  // by the database (content_credentials.beat_variant_id REFERENCES beat_variants), so a manifest with
  // an unknown or missing variant cannot be stored: the insert raises.
  async recordProvenance(claim: C2paClaim): Promise<CredentialRow> {
    const manifest = signManifest(claim);
    return this.db.insertCredential(claim.beat_variant_id, manifest, claim.tier);
  }

  // Persist an already-signed manifest (e.g. produced upstream by W8). Rejected if the signature does
  // not verify, so we never persist an unverifiable provenance record.
  async recordSignedProvenance(manifest: SignedC2paManifest): Promise<CredentialRow> {
    if (!verifyManifest(manifest)) {
      throw new Error("refusing to persist provenance: manifest signature did not verify");
    }
    return this.db.insertCredential(manifest.beat_variant_id, manifest, manifest.tier);
  }

  // Append a consent row to the variant's chain. The service reads the current tip, computes the new
  // prev_hash / row_hash, and inserts. created_at is server-authoritative and committed into the hash.
  async appendConsent(input: ConsentInput): Promise<ConsentRow> {
    const tip = await this.db.getChainTip(input.beat_variant_id);
    const prevHash = tip?.rowHash ?? null;
    // Server-authoritative timestamp, forced strictly after the current tip. The consent chain is read
    // back ordered by created_at, so two appends within the same millisecond would otherwise be
    // ambiguous. Bumping to tip + 1ms keeps the read-back order equal to the append order.
    let createdAt = new Date().toISOString();
    if (tip && createdAt <= tip.createdAt) {
      createdAt = new Date(new Date(tip.createdAt).getTime() + 1).toISOString();
    }
    const content: ConsentContent = {
      likeness_subject: input.likeness_subject,
      beat_variant_id: input.beat_variant_id,
      consent_ref: input.consent_ref,
      royalty_terms: input.royalty_terms ?? null,
      created_at: createdAt,
    };
    const rowHash = computeRowHash(prevHash, content);
    return this.db.insertConsent(input, createdAt, prevHash, rowHash);
  }

  // Given a variant, confirm provenance exists and verifies, and the consent chain is intact back to
  // genesis. A variant is servable only when both hold.
  async verifyVariant(variantId: string): Promise<VerifyResult> {
    const credential = await this.db.getCredential(variantId);
    const hasProvenance = credential !== null;
    const provenanceSignatureValid = hasProvenance ? verifyManifest(credential.manifest) : false;

    const chain = await this.db.getConsentChain(variantId);
    const check = verifyChain(chain);
    const consentChainIntact = check.ok;

    const servable = hasProvenance && provenanceSignatureValid && consentChainIntact;
    let reason: string | undefined;
    if (!hasProvenance) reason = "no provenance record for variant";
    else if (!provenanceSignatureValid) reason = "provenance signature did not verify";
    else if (!consentChainIntact) reason = `consent chain broken at row ${check.brokenAt}: ${check.reason}`;

    return {
      variantId,
      hasProvenance,
      provenanceSignatureValid,
      consentChainIntact,
      consentRowCount: chain.length,
      servable,
      reason,
    };
  }
}

export { TEST_SIGNER_LABEL };
export type { C2paClaim, SignedC2paManifest, ConsentContent, ChainRow };
