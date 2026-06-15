# W9 Trust (provenance + consent) agent brief

**Mission.** Record where every variant came from and who consented to it: C2PA provenance per variant
and a tamper-evident consent ledger for likeness and AI-generated content. This is the rights and trust
layer that a funded incumbent cannot copy quickly. No em dashes.

**Branch.** `w9-trust`, off main. Merge by PR with orchestrator sign-off.

**Owns.** `services/trust/src/**`, `services/trust/test/**`, that package's manifest.

**Consumes (writes the trust tables it owns).**
- Schema (frozen): `content_credentials` (signed C2PA manifest per `beat_variant_id`, NOT NULL link),
  `consent_ledger` (likeness subject, consent ref, royalty terms, and the `prev_hash`/`row_hash` chain).

**Must not touch.** `contracts/`, `supabase/migrations/`, other services' code.

**Build.**
1. Provenance: accept a signed C2PA manifest for a variant (produced by W1) and persist it in
   `content_credentials`, enforcing the not-null link to `beat_variants`.
2. Consent ledger: append-only, hash-chained. Each row carries `prev_hash` and a `row_hash` over its
   contents, so the chain is verifiable and tampering is detectable. This is a signed append-only log,
   NOT a smart contract.
3. A verification routine: given a variant, confirm its provenance exists and its consent chain is
   intact back to the genesis row.

**Definition of done.** Typecheck + lint clean; tests green; FULL `pnpm test` green. A test proves the
hash chain detects a tampered row, and that a variant cannot be marked servable without a provenance
record.

**Tests.** Append several consent rows, verify the chain; mutate a row and assert verification fails;
assert the not-null provenance link is enforced. PGlite with the real migrations.

**Flag, do not fake.** Real C2PA signing keys and a KMS are out of scope for the first cut; use a test
signer and say so. The hash-chain integrity itself must be genuinely tested, not assumed.
