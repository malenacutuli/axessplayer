# Freeze Pass v0.2 : changelog and how to use

This folder is an internally consistent amendment to the frozen-contract candidate. Diff each file against what is in your repo, apply, then clear `contracts/PRE_FREEZE_CHECKLIST.md` and freeze. Contract version bumped to 0.2.0 across schema and all API specs. No em dashes.

## What changed and why
- **PF-1 (viewer_state PK).** `viewer_state` PK is now `(user_id, series_id)`, `series_id NOT NULL`. KV key becomes the composite.
- **PF-2 (decision id).** `decision.yaml` 200 response now returns `decision_id` (required). `events.md` signal events now carry `decision_id` so client signals join to `decision_log`.
- **PF-3 (RLS).** `0001_init.sql` now enables Row Level Security on every table (deny-all by default). Per-table policies remain a per-service gated item tracked in `05_SECURITY_AND_COMPLIANCE.md`.
- **PF-4 (entitlement granularity).** Two changes. First, an `episodes` table is reintroduced between `series` and `beats` so a standard unlock has a referent. `beats` now carries `episode_id`. Second, `entitlements` is generalized to `(user_id, scope, scope_id)` with `scope in {episode, beat_variant}`. Premium variants gain `is_premium` and `coin_cost`; episodes gain `coin_cost`.
- **PF-5 (idempotency scope).** Decided: `coin_transactions` idempotency is per user, `UNIQUE (user_id, client_txn_id)`.
- **PF-6 (manifest/prefetch contract).** Resolved with the client-side branching model. `/manifest` is a pure function of one `variant_id` and returns one seamless playlist. The decision's `prefetch_variant_ids` is a client prefetch hint: the player fetches each candidate's manifest to buffer it for the seamless switch (W5). The `prefetch` query param is removed from `manifest.yaml`. This is W5 IP and needs human sign-off, but the default unblocks the freeze.

## Server-authoritative cost (hardening)
`/spend` no longer accepts a client `cost`. The server derives cost from the catalog by `scope` and `scope_id` (`episodes.coin_cost` or `beat_variants.coin_cost`). The `spend_coins` RPC signature changed accordingly. Never trust the client for price.

## Path reconciliation
The migration file is `contracts/schema/0001_init.sql` (your convention, numbered migrations). The W0 brief task 2 is updated to reference it and to require clearing the pre-freeze checklist before freezing.

## Apply order
1. Diff and apply the five contract files.
2. Replace `AGENTS/W0_orchestrator.md` and `contracts/PRE_FREEZE_CHECKLIST.md`.
3. Confirm PF-6 with the W5 owner (human), then mark the checklist clear and freeze.
