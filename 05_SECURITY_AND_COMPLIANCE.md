# Security and Compliance Invariants

These are non-negotiable and are day-one requirements, not phase-three work.

## Ledger integrity (W2)
- No double-spend, ever. Every spend is an idempotent server-side RPC keyed on a client transaction id, using row-level locking.
- Balances are never computed or trusted on the client.
- `coin_transactions` is an immutable audit log. Never update or delete rows.
- Gate with the concurrency suite plus a security-review subagent and human sign-off.

## Economy trust boundary (W2, F1)
The acting user is always the authenticated session subject, never a value the client supplies. This is the application half of security-review finding F1; migration 0003 closed the database half (spend_coins and grant are EXECUTE-granted to service_role only).
- The economy mutations run only as `service_role`. Clients never hold a credential that can execute `spend_coins` or the grant RPC directly.
- For client-initiated flows (`/wallet`, `/spend`), the acting user is the subject of the session token. The handler derives `user_id` from the verified session and passes it to the RPC. The request body carries no `user_id`, so there is nothing to spoof.
- `/grant` is server-to-server only. It runs from a verified payment receipt or ad/checkin callback, not a direct client call. Its `user_id` is the subject the server already verified out of band.
- Code review rejects any economy handler that reads `user_id`, the wallet owner, or the spending subject from request input rather than from the authenticated context.
- If `spend_coins` is ever exposed in an authenticated session context (PostgREST RPC), it must also carry the in-function guard `IF p_user <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;`. As long as it stays service-role-only with a session-derived `p_user`, that guard is optional.

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
