# Supabase migration runbook : apply 0001..0005 to production

Owned by W11 (infra). This is the ordered, HUMAN-run procedure to apply the committed migrations to a
production Supabase project. It is a runbook, not an automation: applying the schema and the ledger RPCs to
the real database is an irreversible, money-adjacent step that a human runs and verifies. Agents do not run
it. No em dashes.

The migrations are READ-ONLY to W11 (owned by W0). This document only describes how to apply them; it does
not change them.

## Migrations, in order

Apply strictly in this order. Each builds on the previous.

| Order | File | What it does |
| --- | --- | --- |
| 1 | `supabase/migrations/0001_init.sql` | Full schema (users, content graph, viewer_state, decision_log, coin_wallet, coin_transactions, entitlements, content_credentials, consent_ledger). Enables RLS deny-all on every table at the bottom. |
| 2 | `supabase/migrations/0002_spend_rpc.sql` | `spend_coins(p_user, p_scope, p_scope_id, p_client_txn_id)` idempotent ACID spend RPC. |
| 3 | `supabase/migrations/0003_harden_spend_coins.sql` | Hardens the spend path and restricts EXECUTE on the spend RPC to `service_role` (security finding F1, database half). |
| 4 | `supabase/migrations/0004_grant_rpc.sql` | `grant_coins(p_user, p_amount, p_type, p_client_txn_id)` idempotent grant RPC (IAP, rewarded ad, offer wall, checkin, refund), service_role only. |
| 5 | `supabase/migrations/0005_decision_log_propensity.sql` | Adds nullable `decision_log.propensity` for off-policy evaluation. Additive, backward-compatible. |

The walking-skeleton `supabase/seed.sql` is FIXTURE data only. Do NOT apply it to production.

## Prerequisites

- The production Supabase project exists (per `PRODUCTION_CUTOVER_CHECKLIST.md`, all four accounts exist).
- You have either:
  - the Supabase CLI authenticated and the project ref, or
  - a `psql`-capable connection string with sufficient privilege (the migrations CREATE objects and GRANT
    to `service_role`).
- `DATABASE_URL` (or the equivalent connection string) is available from your secret store. It is NOT in
  any tracked file. See `infra/ENV.md`.
- You have a backup or a point-in-time-recovery window confirmed before applying.

## Option A: Supabase CLI (recommended)

1. Link the local repo to the production project (one time):

   ```bash
   supabase link --project-ref <PROD_PROJECT_REF>
   ```

2. Confirm the migration set the CLI will push matches the five files above:

   ```bash
   ls supabase/migrations
   ```

3. Push the migrations to production. This applies any migration not yet recorded in the project's
   `schema_migrations` history, in filename order:

   ```bash
   supabase db push
   ```

   Do NOT run `supabase db reset` against production. `reset` drops and recreates the database.

## Option B: psql (direct)

Apply each file in order against the production connection string. Stop on the first error.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0002_spend_rpc.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0003_harden_spend_coins.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0004_grant_rpc.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0005_decision_log_propensity.sql
```

## Verification queries

Run these AFTER applying. Each should return the expected result before you consider the migration done.

1. All 13 tables exist:

   ```sql
   SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
   -- expect: beat_edges, beat_variants, beats, coin_transactions, coin_wallet, consent_ledger,
   --         content_credentials, decision_log, entitlements, episodes, series, users, viewer_state
   ```

2. RLS is enabled on every public table (no row should be returned):

   ```sql
   SELECT relname FROM pg_class
   WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND NOT relrowsecurity;
   -- expect: zero rows
   ```

3. Both RPCs exist:

   ```sql
   SELECT proname FROM pg_proc
   WHERE proname IN ('spend_coins', 'grant_coins') ORDER BY proname;
   -- expect: grant_coins, spend_coins
   ```

4. EXECUTE on the ledger RPCs is restricted to service_role (the F1 database guard). This should show
   `service_role` and NOT `anon` or `authenticated`:

   ```sql
   SELECT p.proname, r.rolname
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   CROSS JOIN LATERAL aclexplode(p.proacl) a
   JOIN pg_roles r ON r.oid = a.grantee
   WHERE n.nspname = 'public'
     AND p.proname IN ('spend_coins', 'grant_coins')
     AND a.privilege_type = 'EXECUTE'
   ORDER BY p.proname, r.rolname;
   ```

5. The propensity column exists and is nullable:

   ```sql
   SELECT column_name, is_nullable, data_type
   FROM information_schema.columns
   WHERE table_name = 'decision_log' AND column_name = 'propensity';
   -- expect: propensity | YES | double precision
   ```

6. The `coin_transactions` idempotency key exists (no double-grant on webhook redelivery):

   ```sql
   SELECT indexname FROM pg_indexes
   WHERE tablename = 'coin_transactions' AND indexdef ILIKE '%user_id%client_txn_id%';
   -- expect: at least one unique index on (user_id, client_txn_id)
   ```

## Rollback posture

These migrations are additive and create new objects. There is no down-migration committed. If a step
fails, the safe path is: stop, restore from the pre-migration backup or PITR window, fix forward, and
re-run from the failed step. Do not hand-edit production objects out of band; that desynchronizes the
migration history.

## After the migration

- Per-service RLS policies land in later, per-service migrations (per `supabase/migrations/README.md`).
  0001 only enables RLS deny-all. Confirm the owning workstreams have applied their policy migrations
  before any client-context (non service_role) reads are expected to return rows.
- Record the applied migration set and the timestamp in the cutover log
  (`PRODUCTION_CUTOVER_CHECKLIST.md`).
