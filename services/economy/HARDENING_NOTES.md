# Increment : 0003 spend_coins hardening (PROPOSAL, verified, awaiting sign-off)

> **Status: MERGED to main in 731b689.** The "proposal / awaiting sign-off" language below is historical.

Fixes five of the six security-review findings in one migration, with a regression suite that proves
each fix against real Postgres and guards against regression. This is a change to frozen ledger code
and the schema, so it is a proposal for the W2 owner to author or adopt under your sign-off, not a
merge. No em dashes.

## Scope

Fixed: F1 (trust boundary), F2 (search_path / pg_temp shadowing), F3 (idempotency determinism under a
race), F4 (ownership idempotency, own-once), F5 (negative price). Only F6 (zero-cost spends write a
ledger row) is left as a conscious design call. See the divergence note below on why F2 was added to
your F1+F5 lean.

## F4 product decision: own-once

The chosen rule is own-once. This function only ever grants durable entitlements (episodes, premium
variants), never consumables, so re-charging a user for content they already hold is a defect and an
abuse vector. If the user already owns `(scope, scope_id)`, the spend is a no-op that returns the
current balance, checked under the wallet lock so concurrent distinct-txn buys of the same scope settle
to exactly one charge. One consequence, handled here: a wallet can no longer be drained by re-buying the
same scope, so two tests that drained that way (the concurrency overspend test and the F3 replay-at-zero
test) were corrected to drain across distinct scopes (the realistic case).

## Files

- `supabase/migrations/0003_harden_spend_coins.sql` : the migration.
- `services/economy/test/spend_coins.hardening.ts` : regression suite (real Postgres, via the same
  embedded-postgres / DATABASE_URL harness as the concurrency suite).
- `services/economy/package.json` : adds the `test:hardening` script. (Only new line vs the committed
  file; the concurrency script and dev deps already landed in the prior increment.)

## What each fix does

- **F1 trust boundary.** `REVOKE EXECUTE ... FROM PUBLIC` plus revoke from `anon`/`authenticated` and
  grant only to `service_role`. Exposure-independent: the client cannot reach the function regardless
  of how PostgREST is configured. The `auth.uid()` identity guard is left as a documented one-line
  add-on for if you ever expose it in an authenticated session context.
- **F2 search_path.** `SET search_path = ''` and every table reference schema-qualified
  (`public.coin_wallet`, and so on), closing the `pg_temp` definer-shadowing vector.
- **F3 idempotency determinism.** The idempotency `EXISTS` check is moved to AFTER the `FOR UPDATE`, so
  a concurrent duplicate either sees the committed row and no-ops cleanly, or loses the `INSERT` race
  and is caught by an `EXCEPTION WHEN unique_violation` handler that returns the current total. No more
  `23505` surfaced to callers, and a replay never raises a spurious `insufficient_funds`.
- **F4 ownership idempotency.** An `EXISTS` check on `entitlements` under the wallet lock: if the user
  already owns the scope, return the balance with no charge and no ledger row.
- **F5 negative price.** `CHECK (coin_cost >= 0)` on `episodes` and `beat_variants` (blocks it at the
  source), plus an in-function `invalid_price` guard as defense in depth.

## Verified here (real Postgres, not asserted)

`pnpm test:hardening` (and the throwaway scripts that preceded it) on a booted embedded-postgres with
`0001 + 0002 + 0003 + seed` applied:

- **F1 [proven].** `has_function_privilege`: `authenticated` and `anon` cannot execute, `service_role`
  can.
- **F2 [proven, before and after].** With a `pg_temp.coin_wallet` shadow holding 999999 planted in the
  caller's session: the old 0002 function returned 1999993 (read the shadow, vulnerable); the hardened
  function returned 5 and charged the real wallet 10 to 5 (ignored the shadow, safe).
- **F3 [proven].** 40-way same-txn race: exactly one charge, balance 100 to 95, zero
  `unique_violation` surfaced. Replay of an applied txn at balance 0 returns 0, not `insufficient_funds`.
- **F4 [proven].** After a first buy charges 10 to 5 and grants the entitlement, a second buy with a
  new `client_txn_id` for the same scope is a no-op: still 5, one spend row, one entitlement.
- **F5 [proven].** `UPDATE beat_variants SET coin_cost = -5` is rejected by the CHECK constraint.
- **Behavior preserved [proven].** Deduct-once, idempotent replay, bonus-first, `insufficient_funds`,
  and the error paths all still hold on the hardened function. The concurrency suite still proves no
  double-spend (40-way same-txn) and no overspend (50-way across distinct scopes: 20 succeed, 30
  insufficient_funds, balance 0). tsc clean.

## A verifier bug I hit and fixed (verify-don't-assert, applied to myself)

The first F2 check reported FAIL because its final read used an unqualified `coin_wallet` and the
connection pool handed back the same session that still held the temp shadow, so it read 999999 instead
of the real wallet. The function was correct; my test was not. Rewritten to use qualified reads on a
controlled connection, then confirmed before and after. Flagging it because the same class of mistake
(checking the wrong field, then the wrong session) has now bitten twice, and the fix is always to make
the check more precise, not to trust the green.

## Why F2 was folded in (divergence from the F1+F5 lean)

F2 is the other finding that genuinely should not ship: a SECURITY DEFINER function with a shadowing
vector is a privilege-escalation class, and the proof above shows it was live on 0002. The fix is a few
lines and the function was already open for F1 and F3, so excluding it would have meant a second
migration for no benefit.

## Still open

- **F6.** The only remaining finding: a zero-cost spend still writes a ledger row and grants the
  entitlement. Probably intended (a recorded free unlock), but it is a conscious design call, not a
  bug. Left as-is unless you want it changed.
- This migration is unmerged. It needs the W2 owner's sign-off and a version bump, and the CI
  concurrency/hardening jobs (postgres:15 service) to run it on every push.

## A second-order note worth your attention

Own-once changes a real product behavior, not just code: a user can never be charged twice for the same
durable scope. That is almost certainly what you want for episodes and premium variants. If you ever
introduce a genuinely consumable spend (a gift, a tip, a re-roll token), it must NOT go through this
function, because this function now enforces own-once by entitlement. Route consumables through a
separate path. Flagging so the rule is a deliberate boundary, not a surprise later.
