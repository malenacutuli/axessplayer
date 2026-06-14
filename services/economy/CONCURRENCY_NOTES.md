# Increment : spend_coins concurrency suite (W2 definition-of-done)

> **Status: MERGED to main in 731b689.** The "proposal / awaiting sign-off" language below is historical.

The W2 DoD that PGlite structurally cannot prove: fire many concurrent spends at one wallet and assert
no double-spend and no overspend. PGlite is single-connection, so `FOR UPDATE` is uncontended there.
This suite runs against a real multi-connection Postgres. No em dashes.

## Files in this increment

- `services/economy/test/pgharness.ts` : multi-connection harness. Uses `DATABASE_URL` if set (a CI
  `postgres:` service container), otherwise boots a local `embedded-postgres` binary that runs as the
  current user (no root). Applies `supabase/migrations/*.sql` then `supabase/seed.sql`, the `db reset`
  chain.
- `services/economy/test/spend_coins.concurrency.ts` : the two W2 safety tests. Filename is not
  `*.test.ts` on purpose, so it stays out of the fast default suite. Runs via `pnpm test:concurrency`.
- `services/economy/package.json` : adds `test:concurrency` and the dev deps (`pg`, `@types/pg`,
  `embedded-postgres`).

## Verified here (real Postgres, not asserted)

Booted embedded-postgres in the sandbox and ran the suite:

- **No double-spend under a 40-way same-`client_txn_id` race:** exactly 1 ledger row, balance 100 to
  95 (charged once), 1 entitlement. Pass.
- **No overspend under a 50-way distinct-`client_txn_id` race on a 100-coin wallet (cost 5):** exactly
  20 succeed, 30 raise `insufficient_funds`, balance lands on exactly 0, never negative, 20 ledger
  rows. Pass.
- Probe beforehand confirmed real contention: a second connection's `SELECT ... FOR UPDATE` blocked on
  the first's row lock and timed out `while locking tuple`. So the serialization is genuinely
  exercised, not simulated.
- `tsc` clean (NodeNext, with the package's `type: module`).

## The finding for the security review (do not skip this)

The same-txn race observation was `40 fulfilled, 0 rejected, 0 unique_violation`. Safety held (one
charge), but the zero is timing-luck, not a guarantee, and it points at a real shape in the function:

`spend_coins` checks idempotency with an UNLOCKED `EXISTS` read at step 1, then does the LOCKED
`INSERT` at step 4. That is a time-of-check to time-of-use window. Two concurrent calls with the same
`client_txn_id` can both pass the step-1 `EXISTS` (neither committed yet), then serialize on the
wallet lock; the loser reaches the `INSERT` and hits the `UNIQUE(user_id, client_txn_id)` constraint,
raising `unique_violation` (SQLSTATE 23505) instead of the clean no-op the sequential replay returns.

- **Safety is not at risk.** The `UNIQUE` constraint plus `FOR UPDATE` guarantee exactly one charge.
  This is the property the test proves and it holds regardless of timing.
- **Determinism of the no-op is at risk.** Under a tighter race than this run happened to produce, a
  duplicate caller can get a 23505 error rather than the balance. So the API layer in front of this
  RPC must map "23505 on spend" to "already applied, return current balance", or the function should
  be reshaped to make the no-op deterministic (drop the step-1 pre-check and instead catch the
  `unique_violation` from the `INSERT`, then return the current total). That reshape is a security and
  correctness call, which is exactly the W2 review's job. Flagging, not fixing.

Second, smaller note also for the review: `spend_coins` keys idempotency only on `client_txn_id`, not
on entitlement ownership. A user who already owns a scope can be charged again under a new
`client_txn_id`. Whether re-purchase of owned content should be rejected server-side is a product plus
security decision, not an accident the test should paper over.

## CI wiring (the suite belongs in a job with a Postgres service)

`pnpm test:concurrency` is intentionally separate from `pnpm test`. In CI, add a job with a Postgres
service and pass `DATABASE_URL`, so it does not depend on the embedded binary download:

```yaml
  economy-concurrency:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env: { POSTGRES_PASSWORD: pw }
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @axessplayer/economy test:concurrency
        env: { DATABASE_URL: 'postgres://postgres:pw@localhost:5432/postgres' }
```

Use `postgres:15` to match production Supabase, not the local embedded PG18.

## Dependency note

`embedded-postgres` is pinned to `18.4.0-beta.17` (the version verified here) and is a dev-only test
convenience. The suite does not need it when `DATABASE_URL` is set, which is the CI path, so the
embedded binary never has to resolve in CI. Repin freely; the contract is only that some Postgres is
reachable.

## Still carried forward (human sign-off)

- This suite proves the safety invariants. It is not the security review. The TOCTOU window above and
  the ownership-idempotency question are inputs to that review, which still gates the ledger code.
