# Security and Compliance Invariants

These are non-negotiable and are day-one requirements, not phase-three work.

## Ledger integrity (W2)
- No double-spend, ever. Every spend is an idempotent server-side RPC keyed on a client transaction id, using row-level locking.
- Balances are never computed or trusted on the client.
- `coin_transactions` is an immutable audit log. Never update or delete rows.
- Gate with the concurrency suite plus a security-review subagent and human sign-off.

## Provenance (W8, W9)
- Every AI-generated variant (Tier B and Tier C) carries a signed C2PA content credential before it is playable.
- `qa_status` must be `passed` before a variant enters the playable graph.

## Consent and likeness (W9)
- Consented likeness only. No third-party face-swap.
- `consent_ledger` is a signed, append-only, hash-chained table. Not a smart contract.
- Royalty splits compute from view counts and are auditable.

## EU AI Act and privacy (W3, W9)
- The emotional graph is inspectable: expose feature attributions for any decision.
- A user can opt out of adaptive profiling in one action and immediately receive the director's cut.
- Prefer implicit behavioral signals. Do not build prohibited emotion-recognition uses.
- Disclose AI-generated content to viewers where required.

## Platform security
- Row Level Security on all tables. Server-side authorization on every mutation.
- Secrets via environment or vault. Never in code.
- Auth via Supabase. Sessions and tokens handled server-side.
