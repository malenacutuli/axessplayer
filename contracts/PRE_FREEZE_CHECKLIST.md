# contracts/PRE_FREEZE_CHECKLIST.md

**Owner: W0. After freeze pass v0.3: PF-1..PF-5, PF-7, PF-9, PF-11 and minors RESOLVED. OPEN and needing human sign-off: PF-6 (W5), PF-8 (M2 schema decision), PF-10 (M4 manifest decision). Do not freeze until those three are confirmed and a human approves. Target version 0.3.0.** No em dashes.

## Resolved in v0.2 (carried)
- PF-1 viewer_state composite PK. PF-2 decision_id on signals. PF-3 RLS floor. PF-4 episodes + scoped entitlements. PF-5 per-user idempotency.

## Resolved in v0.3 (audit fixes, verify diffs)
- **PF-7 (was M1).** NOT NULL on `beat_variants.beat_id`, `content_credentials.beat_variant_id`, `consent_ledger.beat_variant_id`. No orphans. RESOLVED.
- **PF-9 (was M3).** `coin_transactions.user_id` NOT NULL, so PF-5 idempotency holds on the ledger. RESOLVED.
- **PF-11 (was M5).** `economy.yaml` fully typed: `/wallet/{user_id}` path param + Wallet schema, `/spend` 200 and 402 schemas, `/grant` requestBody. Codegen now yields a working economy client (W0 DoD). RESOLVED.
- **m1.** `coins_spent` carries `decision_id` (nullable). RESOLVED.
- **m2.** `entitlement_granted` carries `client_txn_id`. RESOLVED.
- **m3.** events.md separates beat-level signal events from session events; PF-2 prose scoped to beat-level. RESOLVED.
- **n1.** `prefetch_variant_ids` items are uuid-formatted. RESOLVED.

## Open, needs human sign-off
- **PF-6 (W5).** Manifest and prefetch model: client-side branching, `/manifest` a pure function of one variant_id; `prefetch_variant_ids` is a client hint. Confirm with the W5 owner.
- **PF-8 (was M2).** `beats.series_id` integrity. Applied: composite FK `(episode_id, series_id) REFERENCES episodes(id, series_id)`, plus `episodes UNIQUE (id, series_id)`, inline series ref removed. Keeps single-table series reads for RLS and the decision hot path, and makes divergence impossible. Alternative: drop the column and resolve via episode_id. Confirm the choice.
- **PF-10 (was M4).** Manifest path key. Applied: dropped `session_id`; path is `/manifest/{variant_id}.m3u8`. Alternative: define a real session concept and reflect it in schema and events. Confirm drop vs define.

## W0 brief addition (your flag 2)
W0 gains an explicit task to generate event types from `contracts/events/events.md`. The markdown event schema was not wired into the OpenAPI codegen tasks; event types must still be generated so analytics-sdk, decision, and experiment share a typed event contract.

## Freeze gate
Freeze only when PF-6, PF-8, PF-10 are confirmed with their owners, the resolved diffs are applied, and a human approves. Bump schema and all API specs to 0.3.0.
