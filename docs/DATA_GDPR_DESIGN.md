# Axessplayer Data Governance and GDPR Design

Status: DESIGN. This document describes a target posture and a PROPOSED (un-applied)
schema extension. The companion SQL lives at
`docs/proposals/0006_consent_and_demographics.sql.proposed` and is NOT a migration:
it requires schema/ledger sign-off before it may move under `supabase/migrations/`.

This design is the driving requirement from the product spec "world-class data
capture, ML, and dynamic content": the platform wants rich behavioral signal, a
personalization bandit, and three dynamic features (alternate endings, be-the
protagonist biometric likeness, dynamic product placement). Those ambitions only
ship safely if consent, pseudonymization, and provenance are first-class. This doc
maps every requirement to the REAL tables in `supabase/migrations/0001_init.sql` and
`supabase/migrations/0005_decision_log_propensity.sql`.

House rule observed: no em dashes anywhere in this document.

Recommendation markers: thresholds and windows labeled TUNABLE or PENDING-LEGAL are
recommendations, not committed defaults. Treat them like the placeholder pattern
already used in `services/decision/src/config.ts:32-39` (the EU AI Act explainability
bar awaits counsel). A recommendation is not a ratification.

---

## Sections

1. Lawful-basis matrix
2. Granular consent model (extends `consent_ledger`)
3. Pseudonymization and data minimization (the F1 rule on the event spine)
4. Anonymized demographics (coarse cohort features)
5. Data-subject rights across the event spine and warehouse
6. Retention windows per data category
7. EU AI Act posture
8. How this enables the three dynamic features safely

---

## 1. Lawful-basis matrix

Each processing purpose is mapped to a GDPR Article 6 (or Article 9 for special
category) lawful basis and to whether it requires explicit, separate opt-in. The
purpose enum here is the same enum drafted in the proposed SQL.

| Purpose | Tables touched | GDPR lawful basis | Explicit opt-in? |
|---|---|---|---|
| Provide service (essential) | `users`, `coin_wallet`, `coin_transactions`, `entitlements`, `viewer_state` (state needed to play and unlock) | Art. 6(1)(b) contract; some fraud/integrity under 6(1)(f) | No. Essential, not separately togglable. Withdrawal means closing the account. |
| Analytics and personalization | `decision_log` (`0001_init.sql:83-92`, `propensity` `0005:8-9`), `viewer_state.preference_vector` (`0001_init.sql:74-81`), beat-level signal events (`contracts/events/events.md:5-11`) | Art. 6(1)(a) consent. `users.adaptive_opt_in` (`0001_init.sql:10`) is the existing toggle; opt-out falls back to the director's cut | Yes. Granular, withdrawable. |
| Anonymized demographics (cohort features) | proposed `demographics` table; `viewer_state.cohort_id` (`0001_init.sql:78`) | Art. 6(1)(a) consent to collect the coarse attributes. Aggregated reporting on truly anonymized output is outside GDPR scope, but collection is consented | Yes, separate from analytics. |
| Biometric face feature (be-the-protagonist likeness) | proposed consent rows on the hash chain; `beat_variants.tier = B_likeness` (`0001_init.sql:55`); `consent_ledger` (`0001_init.sql:137-145`) | Art. 9(2)(a) EXPLICIT consent for special-category biometric data, plus US BIPA written-release posture | Yes. Explicit, separate, time-limited, hard-deletable. See section 2b. |
| Product placement (dynamic) | `beat_variants.placement_slots` (`0001_init.sql:62`); `content_credentials` (`0001_init.sql:129-135`) | Art. 6(1)(a) consent when targeted by cohort or behavior; 6(1)(f) for non-targeted contextual placement | Yes when the placement is targeted using personalization or demographics. |
| Security and fraud | `coin_transactions` (`0001_init.sql:103-112`, idempotency key `client_txn_id`), session auth | Art. 6(1)(f) legitimate interest, balanced against the data subject | No separate opt-in. Cannot be withdrawn while the account is active. |

Notes:

- The economy already encodes a hard identity boundary (F1) so the lawful basis for
  "provide service" never silently widens into profiling. See section 3.
- Targeted product placement piggybacks on the analytics_personalization and
  demographics consents. If those are withdrawn, placement degrades to contextual
  (basis 6(1)(f)) only.

---

## 2. Granular consent model

### 2a. Purposes as discrete, withdrawable consents

Today `consent_ledger` (`0001_init.sql:137-145`) records likeness/royalty consent
keyed to a `beat_variant_id`. The trust service appends to it as a tamper-evident,
append-only, hash-chained log:

- `services/trust/src/hashChain.ts:24-27` computes
  `row_hash = sha256(prev_hash || canonical(content))`. Binding the previous row's
  hash makes the chain order-dependent and tamper-evident.
- `services/trust/src/hashChain.ts:45-60` verifies the chain back to a genesis row
  (null `prev_hash`, sentinel "GENESIS" at line 10) and fails closed on any tamper or
  reordering.
- `services/trust/src/trust.ts:93-112` (`appendConsent`) reads the current tip, takes
  a server-authoritative `created_at`, computes `prev_hash`/`row_hash`, and inserts.
  The hash is never trusted from the caller (the adapter owns SQL, the service owns
  hashing, per `trust.ts:37-38`).

The proposed extension generalizes this from "likeness consent per variant" to "any
purpose consent per user." We add a `consent_record` table (see proposal) that reuses
the SAME `prev_hash`/`row_hash` chaining discipline, one chain per `user_id`. Each
purpose is a discrete row with `granted` boolean and a nullable `withdrawn_at`.
Withdrawal is itself an appended row (never an in-place update), so the audit trail of
grant then withdraw is preserved and verifiable exactly like the existing ledger.

Discrete purposes (the enum): `essential`, `analytics_personalization`,
`demographics`, `biometric_face`, `product_placement`. Each is granted and withdrawn
independently. Withdrawing one does not touch the others.

### 2b. policy_version and re-consent

Every consent row carries `policy_version` (text), mirroring the pattern already in
`decision_log.policy_version` (`0001_init.sql:89`) where the engine stamps the exact
policy build (`services/decision/src/config.ts:60-63`). When the privacy policy or
the consent copy changes, the version bumps. A bump invalidates prior consent for the
affected purposes: the user must re-consent, and the new grant appends a fresh row at
the new `policy_version`. The serving path treats "latest row for (user, purpose) is
granted AND its policy_version == current" as the only "consent is live" condition.

### 2c. Biometric consent is special-category and gated

Biometric face data (the be-the-protagonist likeness feature) is GDPR Article 9
special-category data and, for US users, falls under BIPA. Its consent is therefore:

- EXPLICIT and SEPARATE: a standalone `biometric_face` purpose, never bundled into
  analytics or a blanket accept-all.
- TIME-LIMITED: the grant carries an expiry recommendation (TUNABLE, see section 6);
  on expiry it is treated as withdrawn and re-consent is required.
- HARD-DELETABLE: the underlying face features are stored apart from behavioral data
  and are erasable on demand and on expiry, leaving only the immutable consent-event
  record on the chain (which proves consent existed and was later withdrawn, without
  retaining the biometric itself).
- RECORDED ON THE HASH CHAIN BEFORE SERVING: a `biometric_face` grant row must be
  appended to the consent chain (and verify intact via `trust.ts:116-140`
  `verifyVariant`-style verification, consent chain intact branch) BEFORE any
  personalized render that uses the likeness can serve. This ties to spec section 5b:
  no `B_likeness` variant (`beat_variants.tier`, `0001_init.sql:55`) may be rendered
  or served for a user whose latest `biometric_face` consent is not granted, current
  on `policy_version`, and unexpired.

---

## 3. Pseudonymization and data minimization

### 3a. user_id UUID only on the event spine

The event contract (`contracts/events/events.md:3`) makes every event carry
`user_id`, `series_id`, `beat_id`, `ts`, `trace_id`, and beat-level events add
`decision_id` (`events.md:6-11`). The `user_id` is a UUID (`users.id`,
`0001_init.sql:7`). The design rule: events carry the UUID and NEVER email, name, or
precise geolocation. `users.email` (`0001_init.sql:8`) stays in the relational PII
store and is never copied onto the spine or into the warehouse fact tables.

### 3b. The F1 rule extended to the event spine

The economy already enforces F1: the acting user is always the authenticated session
subject, never a value from the request body
(`contracts/api/economy.yaml:3-4`, `:15`, `:44`, `:56`; `AGENTS/W2a_economy_http.md:23-24`).

We extend F1 to the analytics SDK and the decision endpoint: the `user_id` written on
any event is resolved from the session token server-side, never read from the event
body the client posts. This closes user-id spoofing and keeps identity attribution
trustworthy for both reward attribution and erasure. The client may not assert who it
is on the spine any more than it may on `/spend`.

### 3c. PII separated from behavioral and demographic stores

Three stores, three trust zones:

- PII store: `users` (email, language). Relational, access-controlled.
- Behavioral store: `decision_log`, `viewer_state`, event warehouse. Keyed by UUID
  only. Pseudonymous: re-identification requires the `users` join, which is privileged.
- Demographic store: the proposed `demographics` table, keyed by UUID, coarse only.

No store outside `users` holds a direct identifier. This is GDPR pseudonymization
(Art. 4(5)): the additional information needed to attribute data to a person is kept
separately and under access control.

---

## 4. Anonymized demographics

### 4a. Coarse categories only

The proposed `demographics` table stores ONLY coarse, non-identifying attributes:

- `gender` enum including `prefer_not_to_say`
- `age_band` enum (bands such as 18_24, 25_34, ...), NEVER a date of birth
- `country`
- `region` (coarse administrative region, NEVER a precise location, lat/long, or
  postcode)

Explicitly excluded: DOB, precise geo, free-text fields, anything that narrows toward
an individual.

### 4b. Used only as cohort features

These attributes feed cohorting, not targeting of individuals. They map to
`viewer_state.cohort_id` (`0001_init.sql:78`) and to the decision engine's cold-start
cohort path (the bandit's cohort fallback in `services/decision/src/bandit.ts` and
`features.ts`). Before a viewer has personal signal, the engine can lean on the cohort
prior; once `viewer_state.preference_vector` (`0001_init.sql:77`) fills in, the
personal signal dominates. Demographics are an input to a cohort id, not a per-user
profile attribute used to single anyone out.

### 4c. K-anonymity for reporting

Any demographic reporting or cohort export must suppress cells whose membership count
is below a threshold k. RECOMMENDATION (TUNABLE, not a committed default): k >= 20.
This is a starting point in the spirit of the config.ts tunables; the real k awaits a
data and legal review. Below-threshold cells are suppressed (not rounded) so a small
cohort can never be narrowed to an individual. The cohort id itself must never be so
fine-grained that a single `(gender, age_band, country, region)` cell maps to a
handful of users; when it would, cells are merged upward (region dropped first, then
age_band widened) until each surviving cohort clears k.

### 4d. Why this stays non-identifying

Coarse bands plus k-anonymity plus suppression mean no row or report distinguishes one
person. The attributes are population descriptors, not identifiers. Combined with the
pseudonymous UUID key and the separation from `users`, the demographic store carries
no path to an individual on its own.

---

## 5. Data-subject rights across the event spine and warehouse

All rights are keyed off `user_id` (UUID), which is the only identity token on the
spine (section 3). The privileged `users` join resolves a request from a real person
to their UUID; everything downstream is a delete/select by UUID.

| Right (GDPR Art.) | Implementation |
|---|---|
| Access / export, DSAR (15, 20) | Assemble by UUID across `users`, `coin_wallet`, `coin_transactions`, `entitlements`, `viewer_state`, `decision_log`, proposed `demographics`, proposed `consent_record`, and warehouse event facts. Export in a portable format. |
| Rectification (16) | Correct `users` PII and the coarse `demographics` row (append `updated_at`). Behavioral logs are historical fact and are not rewritten. |
| Erasure / right to be forgotten (17) | Delete-by-`user_id` propagated everywhere (see path below). |
| Restriction (18) | Flag the user so serving falls back to the director's cut (mirrors the `adaptive_opt_in` opt-out path and the `is_control` holdout) and downstream processing pauses without deleting. |
| Objection (21) | Withdraw `analytics_personalization` and/or `product_placement` consent; serving degrades to contextual/director's cut. |
| Withdraw consent (7(3)) | Append a withdrawal row to the consent chain for the purpose. Effect is immediate at the serving gate. |

### Erasure propagation path

A right-to-be-forgotten request for `user_id = U` propagates in this order:

1. Stop new writes: revoke the session, mark `U` for erasure so no new events or
   decisions are logged for `U`.
2. Relational delete: remove `U` from `users`, `coin_wallet`, `entitlements`,
   `viewer_state`, proposed `demographics`. Financial rows in `coin_transactions` are
   handled under the legal-minimum retention rule (section 6): retained if a legal
   obligation requires, otherwise deleted; where retained, they are detached from the
   person by removing the `users` link so they survive only as anonymized financial
   audit.
3. Behavioral delete: delete `decision_log` rows where `user_id = U`
   (`0001_init.sql:85`), and delete all event facts for `U` in the warehouse.
4. KV hot copy: purge the decision-engine KV hot copy for `U`. The KV key is the same
   composite as `viewer_state` (`(user_id, series_id)`, `0001_init.sql:80`), so the
   purge enumerates `U`'s series keys and deletes them (`services/decision/src/kv.ts`).
5. Personalized render cache: invalidate and delete any cached personalized or
   likeness render keyed to `U`, including `B_likeness` assets, and hard-delete the
   biometric face features for `U`.
6. Consent chain: the consent-event rows are NOT deleted (they are the append-only
   proof that consent was given and later erased). They retain no PII beyond the UUID
   and the purpose. The biometric PAYLOAD is deleted; the consent EVENT remains as
   tamper-evident audit. If full UUID removal from the chain is legally required, the
   chain is re-sealed by tombstoning (append a tombstone row) rather than mutating
   history, preserving `verifyChain` integrity (`hashChain.ts:45-60`).
7. Verify and certify: re-run a presence check by UUID across all stores; the request
   is closed only when every store except the lawfully-retained financial audit and
   the append-only consent proof returns zero rows for `U`.

---

## 6. Retention windows per data category

All windows below are RECOMMENDATIONS, marked TUNABLE or PENDING-LEGAL. They are not
committed defaults and must be ratified (legal for the regulated ones).

| Category | Tables | Recommended window | Status |
|---|---|---|---|
| Raw events | warehouse event facts (`events.md`) | 13 months rolling, then aggregate-and-drop | TUNABLE |
| Decision log | `decision_log` (`0001_init.sql:83-92`) | 24 months for off-policy training (propensity tuple, `0005:8-9`), then drop raw rows | TUNABLE |
| Biometric face data | likeness feature store; consent on chain | SHORT HARD LIMIT, recommend 30 days after last use OR on consent expiry, whichever first; hard-deleted | PENDING-LEGAL (BIPA, Art. 9) |
| Demographics | proposed `demographics` | While `demographics` consent is live; deleted on withdrawal or erasure | TUNABLE |
| Monetization / financial | `coin_transactions`, `coin_wallet` | Legal minimum (tax/accounting), commonly up to 7 years; retained even past account deletion, detached from PII | PENDING-LEGAL (legal minimum governs) |
| Consent records | proposed `consent_record` | Life of account plus audit window; append-only, never silently purged | PENDING-LEGAL |

The biometric window is deliberately the shortest hard limit in the table. The
financial window is the only one that can OUTLIVE an erasure request, and only because
a legal obligation overrides erasure (GDPR Art. 17(3)(b)); those rows are detached
from the person.

---

## 7. EU AI Act posture

The named-feature decision policy is built to be inspectable and disclosed:

- Inspectable policy: every served decision can emit its top-N contributing NAMED
  features plus the canon filter that bounded the arm set. This is the explainability
  bar in `services/decision/src/config.ts:32-39` (`EXPLAINABILITY_TOP_N = 3`), which
  is the ONE remaining placeholder awaiting counsel ratification. We do not ship it
  unratified, consistent with the comment at config.ts:34.
- Disclosed adaptation: the player is told when the experience is being adapted; the
  opt-out (`users.adaptive_opt_in`, `0001_init.sql:10`) returns the director's cut.
- Control group: a permanent global control holdout always receives the director's cut
  (`CONTROL_HOLDOUT_PCT = 10`, `config.ts:24-30`; `decision_log.is_control`,
  `0001_init.sql:88`). This is the comparison baseline for adaptive lift and a
  fairness check.
- Provenance / C2PA: every generated, personalized, or placed variant carries a signed
  provenance manifest in `content_credentials` (`0001_init.sql:129-135`). The trust
  service signs and verifies it (`services/trust/src/c2pa.ts`,
  `services/trust/src/trust.ts:77-89`), and a variant is servable only when provenance
  exists, its signature verifies, AND the consent chain is intact
  (`trust.ts:116-140`, `servable` at line 125). Note the production cutover gate at
  `c2pa.ts:1-9`: the current signer is a TEST HMAC, and real X.509/KMS C2PA is gated
  behind a human STOP gate. Disclosure as authentic content requires that cutover.

---

## 8. How this enables the three dynamic features safely

### Alternate endings

Alternate endings are `beat_variants` with `role = ending` (`beats.role`,
`0001_init.sql:40`) selected by the decision engine. They run on the
`analytics_personalization` consent: if it is withdrawn or the user is opted out
(`adaptive_opt_in`) or in the control holdout, the player gets the director's cut
ending. Each ending variant still carries C2PA provenance
(`content_credentials`), and the decision that chose it is logged with its
`policy_version` and `propensity` (`decision_log`, `0005:8-9`) for inspectability.

### Be-the-protagonist (biometric likeness)

A `B_likeness` variant (`beat_variants.tier`, `0001_init.sql:55`) personalizes the
protagonist with the viewer's face. It may render and serve ONLY after an explicit,
separate, current, unexpired `biometric_face` consent row is appended and verified on
the hash chain (section 2c), before the render. The face features live in a separate,
hard-deletable, short-retention store (sections 5 and 6). The rendered likeness asset
carries C2PA provenance, and on consent withdrawal or expiry the asset and features
are hard-deleted while the consent-event proof remains on the chain.

### Dynamic product placement

Placements live in `beat_variants.placement_slots` (`0001_init.sql:62`). Contextual
(non-targeted) placement runs under legitimate interest. The moment a placement is
targeted using personalization or demographics, it requires the
`product_placement` consent (and the underlying analytics/demographics consents); if
any is withdrawn it degrades to contextual. Every placed variant carries C2PA
provenance so a placement is always traceable to a signed, consented source, which
also satisfies the AI Act disclosure posture in section 7.

---

## Cross-reference: where this is grounded

- Schema: `supabase/migrations/0001_init.sql` (consent_ledger 137-145, viewer_state
  74-81, decision_log 83-92, coin_transactions 103-112, entitlements 114-120,
  beat_variants incl. placement_slots 48-63).
- Propensity: `supabase/migrations/0005_decision_log_propensity.sql:8-9`.
- Event spine: `contracts/events/events.md:3-25`.
- Reward weights and ratification pattern: `services/decision/src/config.ts:14-63`.
- F1 identity boundary: `contracts/api/economy.yaml:3-4`,
  `AGENTS/W2a_economy_http.md:23-24`.
- Hash chain and C2PA: `services/trust/src/hashChain.ts`, `trust.ts`, `c2pa.ts`.
- Proposed SQL: `docs/proposals/0006_consent_and_demographics.sql.proposed`.
