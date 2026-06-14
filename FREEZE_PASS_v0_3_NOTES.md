# Freeze Pass v0.3 : audit fixes (changelog and apply order)

This pass applies the read-only audit findings (26 agents, 20 raw findings, 10 confirmed after adversarial filtering) on top of the v0.2.0 candidate. Contract version bumps to 0.3.0 across schema and all API specs. Diff each file against the repo, apply, then resolve the two open sign-offs and freeze. No em dashes.

## Confirmed findings, mapped to fixes
- **M1 (major) RESOLVED.** `beat_variants.beat_id`, `content_credentials.beat_variant_id`, `consent_ledger.beat_variant_id` are now NOT NULL. No orphan variants or orphan provenance/consent.
- **M2 (major) APPLIED, needs sign-off (PF-8).** `beats.series_id` is kept for single-table series reads, but divergence is now impossible: `episodes` gains `UNIQUE (id, series_id)` and `beats` gains a composite FK `(episode_id, series_id) REFERENCES episodes(id, series_id)`. The inline `beats.series_id REFERENCES series(id)` is removed since integrity is transitive through the composite FK. Alternative was to drop the column. Recommended: keep with the composite FK, because RLS and the decision hot path read series without a join. Your call to confirm.
- **M3 (major) RESOLVED.** `coin_transactions.user_id` is NOT NULL, so PF-5's `UNIQUE (user_id, client_txn_id)` actually enforces idempotency on the ledger.
- **M4 (major) APPLIED, needs sign-off (PF-10).** `session_id` is dropped from the manifest path. New path: `/manifest/{variant_id}.m3u8`. It was vestigial from the pre-PF-6 design. `decision_id` and `trace_id` cover analytics, so no session concept is introduced. Alternative was to define a real session and reflect it in schema and events. Recommended: drop. Your call to confirm.
- **M5 (major) RESOLVED.** `economy.yaml` now fully specifies `/wallet/{user_id}` (path param + response schema), `/spend` 200 and 402 response schemas, and `/grant` requestBody. Typed clients now generate, satisfying W0's Definition of Done.
- **m1 (minor) RESOLVED.** `coins_spent` carries `decision_id` (nullable when no triggering decision), so premium-variant spend lift ties to the decision arm.
- **m2 (minor) RESOLVED.** `entitlement_granted` carries `client_txn_id`, joinable to the `coin_transactions` row.
- **m3 (minor) RESOLVED.** `events.md` now separates beat-level signal events from session events. The PF-2 claim is scoped to "beat-level signal events carry decision_id," which is now literally true. `session_ended` lives in its own Session events section.
- **n1 (nit) RESOLVED.** `decision.yaml` `prefetch_variant_ids` items are now `{ type: string, format: uuid }`.

## What the audit refuted (10), so trust the above more
Accepted as design, not bugs: polymorphic `reference_id` TEXT, `provenance_id` not an FK (enforced via content_credentials.beat_variant_id), deny-all RLS (service_role bypasses), `/decide` keying on current_beat_id (episode derivable), three-way variant-id naming (next / served / variant is intentional role distinction), and "missing kit docs" (this is an amendment bundle, not the full repo).

## Also folded in (your flag 2)
W0 brief gains an explicit task to generate event types from `contracts/events/events.md`, since the markdown event schema was not wired into the OpenAPI codegen tasks.

## Apply order
1. Diff and apply the five contract files (schema, economy, decision, manifest, events).
2. Replace `contracts/PRE_FREEZE_CHECKLIST.md` and `AGENTS/W0_orchestrator.md`.
3. Add `contracts/AUDIT_v0.2.0.md` (the verdict, for the record).
4. Confirm PF-6 (W5), PF-8 (M2), PF-10 (M4) with the owners, then mark the checklist clear and freeze at v0.3.0.
