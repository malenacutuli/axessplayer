# Event schema. Contract version 0.3.0. Owned by W0.

All events carry `user_id`, `series_id`, `beat_id`, `ts`, and a `trace_id`.

## Beat-level signal events (analytics-sdk -> decision, experiment)
Every beat-level signal event carries `decision_id` so it joins to `decision_log.id` for reward attribution (PF-2).
- `beat_started`   { decision_id, variant_id, is_control }
- `beat_progress`  { decision_id, variant_id, completion }       # at 25/50/75/100 percent
- `beat_completed` { decision_id, variant_id, completion }
- `beat_skipped`   { decision_id, variant_id, at_completion }
- `choice_made`    { decision_id, beat_id, choice, latency_ms }

## Session events (analytics-sdk -> experiment)
Session-scoped, not tied to a single decision.
- `session_ended`  { last_beat_id, total_ms }                    # m3: session-scoped, no decision_id by design

## Ledger events (economy -> experiment, analytics)
- `coins_granted`       { amount, type, client_txn_id }
- `coins_spent`         { amount, scope, scope_id, client_txn_id, decision_id }   # m1: decision_id nullable when no triggering decision
- `entitlement_granted` { scope, scope_id, client_txn_id }                        # m2: joinable to coin_transactions

## Decision events (decision -> experiment)
- `decision_made` { decision_id, beat_id, served_variant_id, is_control, policy_version }

These events are the substrate for adaptive-lift measurement (W10). Their shape is frozen at v0.3.0.
