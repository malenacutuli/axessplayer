# contracts/PRE_FREEZE_CHECKLIST.md

**Owner: W0. Status after freeze pass v0.2: PF-1..PF-5 RESOLVED in the amended files. PF-6 OPEN, needs W5 human sign-off. Do not freeze until PF-6 is confirmed and a human approves.** No em dashes.

## Resolved in freeze pass v0.2 (verify the diffs, then check off)
- **PF-1 viewer_state PK.** Now `(user_id, series_id)`, `series_id NOT NULL`. KV key composite. RESOLVED in `0001_init.sql`.
- **PF-2 decision id.** `decision.yaml` returns `decision_id`; `events.md` signal events carry `decision_id`. RESOLVED.
- **PF-3 RLS.** `0001_init.sql` enables RLS on every table (deny-all). Per-table policies tracked per service in `05_SECURITY_AND_COMPLIANCE.md`. RESOLVED at the floor; policies remain a per-service gate.
- **PF-4 entitlement granularity.** `episodes` table added; `beats.episode_id` added; `entitlements(user_id, scope, scope_id)`; `is_premium` + `coin_cost` on variants and `coin_cost` on episodes. `economy.yaml` `/spend` takes `scope`+`scope_id`. RESOLVED.
- **PF-5 idempotency scope.** `coin_transactions UNIQUE (user_id, client_txn_id)`. RESOLVED.

## Open
- **PF-6 manifest and prefetch contract (W4 and W5).** [Needs human sign-off]
  Decision (recommended, applied to the specs): client-side branching. `/manifest` is a pure function of one `variant_id` and returns one seamless playlist. The decision's `prefetch_variant_ids` is a client prefetch hint; the player fetches each candidate's manifest to buffer it and switches client-side (W5 dual-decoder or pre-stitched). The `prefetch` query param is removed from `manifest.yaml`.
  Why this default: it keeps W4 simple and puts the branching IP in W5 where human design owns it. Confirm with the W5 owner before freezing. If W5 prefers server-side multi-variant stitching, `manifest.yaml` changes and this is a freeze blocker until resolved.

## Hardening applied alongside the fixes
- **Server-authoritative price.** `/spend` no longer accepts a client `cost`. The server derives price from `episodes.coin_cost` or `beat_variants.coin_cost`. `spend_coins` RPC signature updated.

## Carried-over (confirm, not blocking)
- Human sign-off owners: ledger (W2), seamless switch (W5), decision policy (W3), trust legal posture (W9).
- Sequencing: the walking skeleton is the week-6-to-8 milestone, not deferred behind the clone.

## Freeze gate
Freeze only when: the five resolved diffs are applied, PF-6 is confirmed with the W5 owner, carried-over items are confirmed, and a human approves. Contract version is 0.2.0 across schema and all API specs.
