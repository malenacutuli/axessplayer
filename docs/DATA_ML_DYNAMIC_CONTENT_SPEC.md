# Axessplayer: world-class data capture, ML, and dynamic content spec

**Version 1.0 - June 2026 - Axessible Technologies**

> Canonical product/data roadmap. This is the north star for the capture pipeline, the ML loop, and the
> three dynamic premium features. It is a forward plan: most of it crosses frozen schema/contract gates
> and human gates (real generation, biometric consent infra, C2PA keys, warehouse provisioning). The
> consent + GDPR foundation in `apps/web/src/consent`, the legal templates in `apps/web/public/legal`,
> and the data governance design in `docs/DATA_GDPR_DESIGN.md` are the first landed slice. No em dashes.

## 0. Thesis

Data is the fuel of the moat. The architecture is a closed loop: capture everything at beat granularity,
let ML turn it into per-viewer decisions and generative variants, and let the team control what gets
served through rules. All three advanced features are the same move the platform already makes: serve a
different variant of one production to each viewer. An alternate ending is a variant. A version with the
viewer's face is a variant. A version with a different brand on the table is a variant. So none of this
is a new platform; it is the variant catalog plus the decision engine plus a richer capture and ML layer
on top of what already exists (`beat_variants`, `decision_log`, `viewer_state`, `consent_ledger`, the
bandit).

## 1. What to capture

- **Stream A - Quality of Experience:** time to first frame, startup time, rebuffering ratio + events,
  bitrate and resolution shifts, dropped frames, playback errors and types, live latency, CDN edge and
  cache status. Sub-minute granularity, monitored in real time.
- **Stream B - Engagement:** play, pause, seek, scrub, watch time, completion, quartile completion
  (25/50/75/100), rewatch/replays, skip patterns, drop-off timestamps, session length, swipe next/prev,
  dwell before tap, browse/search, list adds, shares.
- **Stream C - Beat-level adaptive signals (the differentiator):** per beat - completion, which branch +
  cut served, the `decision_id`, the propensity, control vs treatment, prefetch hit/miss, seamless-switch
  latency, inferred intensity/pace preference, choice latency, and the reward outcomes attributed back to
  each decision (continue, return, spend). No incumbent has this because no incumbent re-cuts per viewer.
- **Stream D - Monetization:** paywall impressions, unlock conversions, coin spends + grants, rewarded ad
  views/completions, subscription events, derived LTV signals.
- **Stream E - Identity, context, consent:** device class, network type, time of day, locale, the
  accessibility tracks actually used, cohort assignment, and for any generated/personalized/placed
  variant the consent + provenance reference tied to the consent ledger.

## 2. Back end capture

**Event envelope:** every event is a typed JSON record with `event_id`, `event_type`, `user_id` (the
session subject, never from the client body, per F1), `session_id`, `series_id`, `beat_id`, `variant_id`,
`decision_id`, `ts`, `client_ts`, plus an event-specific `payload`. Beat-level signal events carry the
`decision_id` so outcomes attribute to the decision that caused them. Extends
`contracts/events/events.md`.

**Pipeline:** SDK + services emit events -> edge collector -> durable stream (Kafka/Kinesis/PubSub) ->
fans out hot (KV viewer vector for the next `/decide` + real-time dashboards) and cold (warehouse for
analytics + offline ML). `decision_log.propensity` is the join key that makes honest off-policy
evaluation possible. QoE lands in the same warehouse so QoE and engagement analyze together.

**Rules:** first-party + consent-gated by default, no PII in URLs/query strings, the decision path reads
the KV hot copy (never Postgres) to hold sub-50ms, logging is async off the serving path.

## 3. Front end reporting

**Studio (creators/ops):** story-graph retention (beat-by-beat drop-off on the branch editor), branch
performance (which cut the engine chose, completion + return per branch vs the director's-cut control =
the adaptive-lift number per scene), paywall + economy (impressions, conversion, revenue per
episode/chapter, learned optimal paywall placement), localization + cohort slices, ending A/B head to
head.

**Executive + real-time:** the adaptive-lift dashboard (treatment vs control on completion, return,
revenue = the single most important chart in the company); real-time concurrent viewers, QoE, CDN egress
+ cost, decision-tier latency, prefetch waste.

**Tech:** warehouse to a BI tool (Looker/Metabase/Superset) plus a custom React Studio dashboard on the
brand tokens reading a thin analytics API, plus the stream driving real-time tiles.

## 4. The ML layer

Closed loop: capture, train offline, publish a versioned policy, serve, capture again. Models by value:
1. the contextual bandit (W3) selecting the next beat variant - the engine of every dynamic feature;
2. a reward model blending completion + return + monetization, attributed via `decision_id`;
3. retention/churn prediction and propensity scoring for off-policy evaluation;
4. cohort segmentation + content embeddings for cold-start + recommendation;
5. a sequence model over the viewer's beat history once data justifies it.
Off-policy evaluation (IPS, doubly-robust) estimates a new policy's value before it serves traffic. That
is why propensity is logged.

## 5. The three dynamic features (all are "serve a different variant")

- **5a. Machine-generated alternate endings.** Endings are `beat_variants` on the ending beat. The bandit
  chooses among existing endings; a generative step proposes new ones informed by what converts. Every
  generated ending is QA-gated and C2PA-signed before it can serve. The premium ending is the coin unlock
  the hardened `spend_coins` already enforces.
- **5b. Be the protagonist (face personalization, premium).** A per-viewer variant that cannot be
  pre-cached: render on demand into a per-user cache, gated behind subscription/credits because render
  has real cost. The viewer's likeness is a locked identity applied to the protagonist track.
  Non-negotiable consent + rights: three consents must be on the hash chain before a personalized render
  serves - the viewer's biometric consent to use their face (explicit, revocable), the original actor's
  likeness consent (the B-tier likeness variant), and rights to the underlying production. Add
  verified-permission face matching to block uploading a face that is not yours. This is biometric data:
  BIPA + GDPR Article 9 apply, so explicit consent, a retention limit, and a hard right-to-delete are
  mandatory, and every render is C2PA-signed.
- **5c. Dynamic in-scene product placement.** `beat_variants.placement_slots` already exists. A slot
  declares a fillable region; at serve time the decision engine picks which campaign fills it using
  contextual + addressable targeting and first-party data; the choice is logged like any decision. A
  Studio placement-rules engine defines slots, assigns campaigns by market/cohort/daypart/sold deal, sets
  frequency caps, with brand-safety + canon-safety as hard filters. Every filled slot is written with its
  campaign + consent/licensing reference.

## 6. Extensions, not a rebuild

Hooks that already exist: `placement_slots` on `beat_variants`, `decision_log` with `propensity`,
`viewer_state`, the `consent_ledger` hash chain, the events contract carrying `decision_id`, and the
bandit. New build: the capture pipeline + warehouse, the Studio analytics, the generative endings step,
the personalized-render path, and the placement-rules engine. Each rides the existing spine.

## 7. Build sequence

1. **Capture + reporting first.** Event pipeline, warehouse, Studio analytics dashboards. You cannot do ML
   or prove lift without the data, and the dashboards make the platform sellable to studios and brands.
2. **The ML loop.** Bandit, reward model, off-policy evaluation, the adaptive-lift dashboard.
3. **Dynamic product placement.** Placement-rules engine + the VPP render path. Nearest-term revenue;
   reuses `placement_slots`.
4. **Be the protagonist.** Heaviest, because of render cost + the consent and legal surface. Gate behind
   subscription/credits and the consent ledger. Alternate endings run continuously once the generation
   pipeline and the bandit are live.

## 8. Privacy, legal, ethics (must-haves)

- First-party + consent-gated capture, no PII in URLs, GDPR + CCPA compliant.
- Biometric consent for any face feature (BIPA, GDPR Article 9): explicit, time-limited, deletable.
- EU AI Act: keep the decision policy inspectable (the named-feature model), disclose adaptation.
- C2PA provenance + the consent ledger on every generated/personalized/placed variant, so every synthetic
  frame is traceable and every likeness and placement is permissioned.
- Verified-permission face matching to prevent likeness abuse on the protagonist feature.

## Status against this spec (2026-06-15)

Landed: consent gate + anonymized demographics + GDPR data-subject rights in the consumer app
(`apps/web/src/consent`), Privacy Policy + Terms templates (`apps/web/public/legal`, pending counsel), the
GDPR data governance design + proposed consent/demographics schema (`docs/DATA_GDPR_DESIGN.md`,
`docs/proposals/0006_consent_and_demographics.sql.proposed`, pending sign-off). Already built earlier: the
decision log with propensity, the LinUCB bandit, off-policy evaluation (IPS/DR), the ratified reward
weights. Not yet built: the event capture pipeline + warehouse, client event emission (the player SDK has
unused `recordSignals` hooks and `/decide` currently carries empty signals), the Studio analytics
dashboards, the generative endings step, the personalized-render path, and the placement-rules engine.

## Sources

- FastPix: Guide to Video Analytics for OTT Platforms, key metrics 2026
- Medium: The Definitive Guide to Media QoE Metrics
- Mux: Live Streaming Analytics, the metrics that matter; Mux Data (QoE monitoring)
- Mirriad: What is Virtual Product Placement; StreamTV Insider: Amagi integrates Mirriad AI for VPP
- Autoppt: AI face swap + character replacement, 2026 landscape and ethics; Creativize AI: Kling FaceSwap
