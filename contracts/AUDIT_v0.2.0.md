# Audit of the v0.2.0 freeze candidate

**Method.** A read-only freeze-readiness audit: 26 reviewer agents across six lenses (schema-to-API alignment, PF-resolution integrity, event and lift join-keys, naming and version drift, SQL integrity, freeze executability). 20 raw findings, each put through an adversarial skeptic that defaults to refuting. Result: 10 confirmed, 10 refuted.

## Verdict
Not yet freezable. No architectural defect. Five majors, three minors, one nit, plus the still-open PF-6. All are surgical and cheap before agents build against the contract, migration-painful after. Resolved in freeze pass v0.3 (see FREEZE_PASS_v0_3_NOTES.md), with two carrying a design decision for human sign-off.

## Confirmed findings
| Id | Sev | Issue | Files | Fix |
|---|---|---|---|---|
| M1 | major | `beat_variants.beat_id` nullable (also content_credentials and consent_ledger links): orphan rows break variant to beat to episode resolution. | 0001_init.sql | NOT NULL on the links. |
| M2 | major | `beats.series_id` denormalized with nothing forcing it to equal the episode's series. RLS and viewer_state scope on it. | 0001_init.sql | Composite FK to episodes(id, series_id) + UNIQUE(episodes.id, series_id). (Sign-off.) |
| M3 | major | `coin_transactions.user_id` nullable, so PF-5 UNIQUE(user_id, client_txn_id) does not guarantee idempotency on the ledger. | 0001_init.sql | NOT NULL on user_id. |
| M4 | major | Manifest `{session_id}` path key exists nowhere else in the contract set. PF-6 reframed /manifest on variant_id but left session_id dangling. | manifest.yaml | Drop session_id; key on variant_id. (Sign-off.) |
| M5 | major | `/wallet` and `/grant` underspecified: codegen yields a non-functional economy client, violating W0's DoD. | economy.yaml | Add path param, response and request schemas. |
| m1 | minor | `coins_spent` has no decision_id, so premium-spend lift cannot tie to the decision arm. | events.md | Add decision_id (nullable). |
| m2 | minor | `entitlement_granted` has no client_txn_id, not joinable to its transaction. | events.md | Add client_txn_id. |
| m3 | minor | `session_ended` listed under signal events but has no decision_id, making the PF-2 blanket claim false. | events.md | Scope prose to beat-level; separate session events. |
| n1 | nit | `prefetch_variant_ids` items lack format: uuid. | decision.yaml | Add format: uuid. |

## Refuted by the adversarial pass (accepted design, not bugs)
- `reference_id` polymorphic TEXT: correct for a mixed receipt and scope_id audit column.
- `provenance_id` not an FK: redundant, enforced via content_credentials.beat_variant_id.
- "deny-all RLS blocks the services": false, service_role bypasses RLS.
- `/decide` keying on current_beat_id: episode is derivable via beats.episode_id.
- Three-way variant-id naming (next / served / variant): intentional role distinction across API, persistence, analytics.
- "missing kit docs": this was an amendment bundle, not the full repo.

The verification layer paid for itself: it killed ten plausible-but-wrong findings.
