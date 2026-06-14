# Event schema. Contract version 0.2.0. Owned by W0.

All events carry `user_id`, `series_id`, `beat_id`, `ts`, and a `trace_id`.
PF-2: signal events also carry `decision_id` so they join to `decision_log.id` for reward attribution.

## Signal events (analytics-sdk -> decision, experiment)
- `beat_started`   { decision_id, variant_id, is_control }
- `beat_progress`  { decision_id, variant_id, completion }       # at 25/50/75/100 percent
- `beat_completed` { decision_id, variant_id, completion }
- `beat_skipped`   { decision_id, variant_id, at_completion }
- `choice_made`    { decision_id, beat_id, choice, latency_ms }
- `session_ended`  { last_beat_id, total_ms }

## Ledger events (economy -> experiment, analytics)
- `coins_granted`       { amount, type, client_txn_id }
- `coins_spent`         { amount, scope, scope_id, client_txn_id }   # PF-4: scope replaces bare variant
- `entitlement_granted` { scope, scope_id }

## Decision events (decision -> experiment)
- `decision_made` { decision_id, beat_id, served_variant_id, is_control, policy_version }

These events are the substrate for adaptive-lift measurement (W10). Their shape is frozen at v0.2.0.
