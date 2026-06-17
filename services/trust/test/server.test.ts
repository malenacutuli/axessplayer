// Spec test for the trust serve listener (P7-T1/T2/T3). Drives the HTTP surface against an in-memory
// TrustDB: record provenance, append consent, and verify the variant (the Article 50 / provenance
// tap-through). A variant is servable only when signed provenance exists AND the consent chain is intact;
// tampering with a consent row makes it unservable. No em dashes.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { TrustService, type TrustDB, type CredentialRow, type ConsentRow, type ConsentInput } from "../src/trust.js";
import type { SignedC2paManifest } from "../src/c2pa.js";
import { createTrustServer } from "../src/server.js";

class FakeDB implements TrustDB {
  creds = new Map<string, CredentialRow>();
  chains = new Map<string, ConsentRow[]>();
  private seq = 0;
  async insertCredential(beatVariantId: string, manifest: SignedC2paManifest, tier: string): Promise<CredentialRow> {
    const row: CredentialRow = { id: `c${++this.seq}`, beat_variant_id: beatVariantId, manifest, tier };
    this.creds.set(beatVariantId, row);
    return row;
  }
  async getCredential(beatVariantId: string): Promise<CredentialRow | null> {
    return this.creds.get(beatVariantId) ?? null;
  }
  async getChainTip(beatVariantId: string): Promise<{ rowHash: string; createdAt: string } | null> {
    const c = this.chains.get(beatVariantId) ?? [];
    if (!c.length) return null;
    const last = c[c.length - 1];
    return { rowHash: last.row_hash, createdAt: last.content.created_at };
  }
  async insertConsent(input: ConsentInput, createdAt: string, prevHash: string | null, rowHash: string): Promise<ConsentRow> {
    const row: ConsentRow = {
      id: `k${++this.seq}`,
      prev_hash: prevHash,
      row_hash: rowHash,
      content: {
        likeness_subject: input.likeness_subject,
        beat_variant_id: input.beat_variant_id,
        consent_ref: input.consent_ref,
        royalty_terms: input.royalty_terms ?? null,
        created_at: createdAt,
      },
    };
    const arr = this.chains.get(input.beat_variant_id) ?? [];
    arr.push(row);
    this.chains.set(input.beat_variant_id, arr);
    return row;
  }
  async getConsentChain(beatVariantId: string): Promise<ConsentRow[]> {
    return this.chains.get(beatVariantId) ?? [];
  }
}

let db: FakeDB;
let base: string;
const server = (() => {
  db = new FakeDB();
  return createTrustServer(new TrustService(db));
})();

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});
after(() => server.close());

const claim = (variant: string) => ({
  beat_variant_id: variant,
  tier: "C_ai",
  generator: "W8/generation",
  asset_hash: "deadbeef",
  created_at: "2026-06-17T00:00:00.000Z",
});

describe("trust serve listener", () => {
  it("records signed provenance and appends a consent row, then reports the variant servable", async () => {
    const v = "11111111-1111-1111-1111-111111111111";
    const p = await fetch(`${base}/provenance`, { method: "POST", body: JSON.stringify(claim(v)) });
    assert.equal(p.status, 201);
    const c = await fetch(`${base}/consent`, {
      method: "POST",
      body: JSON.stringify({ likeness_subject: "actor:strawberry", beat_variant_id: v, consent_ref: "DPA-2026-001" }),
    });
    assert.equal(c.status, 201);
    const verify = await (await fetch(`${base}/verify/${v}`)).json();
    assert.equal(verify.hasProvenance, true);
    assert.equal(verify.provenanceSignatureValid, true);
    assert.equal(verify.consentChainIntact, true);
    assert.equal(verify.servable, true);
  });

  it("a variant with no provenance is not servable (disclosure, with a reason)", async () => {
    const verify = await (await fetch(`${base}/verify/00000000-0000-0000-0000-000000000000`)).json();
    assert.equal(verify.servable, false);
    assert.match(verify.reason, /no provenance/);
  });

  it("tampering a consent row breaks the chain and makes the variant unservable", async () => {
    const v = "22222222-2222-2222-2222-222222222222";
    await fetch(`${base}/provenance`, { method: "POST", body: JSON.stringify(claim(v)) });
    await fetch(`${base}/consent`, { method: "POST", body: JSON.stringify({ likeness_subject: "s", beat_variant_id: v, consent_ref: "ref" }) });
    // tamper the stored consent content after the fact
    db.chains.get(v)![0].content.consent_ref = "ref-altered";
    const verify = await (await fetch(`${base}/verify/${v}`)).json();
    assert.equal(verify.consentChainIntact, false);
    assert.equal(verify.servable, false);
  });
});
