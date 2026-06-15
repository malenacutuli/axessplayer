# The reconciled build plan: parallel B2B and B2C on one engine

**Version 1.0 - June 2026 - Axessible Technologies.** The canonical roadmap that merges the five strategy
reviews + the founder directive. Supersedes the sequencing debate: B2B and B2C ship IN PARALLEL because it
is one engine with two front doors. No em dashes.

## The hard rule (governs every render decision)

**Both front doors ride one shared engine over cached + pre-rendered variants. No path the free consumer
hits depends on live per-viewer generation. Generative personalization is a credit-gated premium, never the
default render.** Economics: precompute everything; personalize with cheap layers (language, accessibility,
cut selection, placement); reserve expensive generation ($0.10-0.15/sec) for credit-gated premium + B2B
deals. Keep uniquely-generated runtime near zero for free users.

## One engine, two front doors

Shared spine (built once): content graph, variant store + CDN, decision + manifest service, economy ledger,
consent + provenance layer, player SDK. Studio (B2B, content in) and Consumer app (B2C, content out) are
THIN clients on top. Governance rule: business logic lives in the shared services; the front doors stay
thin; never fork the data model or business logic per front door.

## Three-sided monetization, one content library

Users (coin wallet, deterministic unlocks/subs - no randomized paid mechanics per EU Digital Fairness Act);
Brands (placement engine, in-scene placement rendered into a beat_variant, brand-safety + canon-safety hard
filters); Sponsors (sponsorship slots + branded interstitials on the SEPARATE ad plane). All resolve through
one idempotent attributed ledger; creator/production revenue share is a query over attributed entries.

## Honoring axessplayer.com honestly (EU AI Act Article 50, enforceable 2 Aug 2026)

The homepage promises "the story re-cuts itself for every viewer." Backed honestly per phase:
- Launch = CACHED adaptation: every viewer genuinely gets their language, accessibility profile, and a
  narrative cut selected from PRE-RENDERED variants by the manifest. Real per-viewer re-cutting by
  selection. Affordable, true on day one.
- Premium = credit-gated be-the-protagonist (face-swap onto a cached base render), covering marginal cost.
  Never a unique full generation per free viewer.
- Article 50: adapted/synthetic content must be DISCLOSED, human-readable AND machine-readable. The "why
  this cut" panel IS the honest delivery of the promise and the compliance mechanism. Build disclosure into
  the render graph, not a last-mile badge. An unbacked "re-cuts itself" claim overclaims and, after August,
  breaks the law; cached adaptation makes the claim true now.

## Section 8 ship order, mapped to STATUS (2026-06-15)

1. **Beat-level capture + consent/provenance + cluster fixes (no GPU).**
   - Capture: DONE (Phase 0, commit a7f51a1 - real /decide signals + consent-gated beat events).
   - Consent layer: DONE (apps/web/src/consent, GDPR gate + anonymized demographics + rights).
   - Provenance: trust service has C2PA test signer; consent_ledger exists. Real keys gated.
   - Cluster fixes: FLAGGED (swissbrain-prod audit logging OFF -> turn on + patch cadence; see
     docs/NARRATIVE_WORLD_MODEL.md infra findings).
2. **Ingest + host original micro-series with language + a11y variants.**
   - Upload loop: DONE locally (tools/media-server + Studio upload + preview + consumer playback). Real S3
     path = Path A slice 1 (docs/PATH_A_PROVISIONING.md), reuse Supabase faeyekynudyzeotbjfsj.
3. **Consumer app: feed, player, cached adaptation, wallet, disclosure.**
   - Feed + immersive player + wallet + paywall + a11y sheet: DONE. Player rotates vertical<->landscape.
   - Cached per-viewer adaptation by manifest: PARTIAL (decision/manifest services exist; cut selection
     wired; richer variant set TODO).
   - "Why this cut" disclosure (Article 50): IN PROGRESS (this build).
4. **Studio: branch editor, variant + slot authoring, publish, analytics.**
   - Branch editor + variant upload + pricing + publish + diffable graph export: DONE.
   - Placement-slot authoring: TODO (placement_slots field exists on beat_variants).
   - Story-graph retention + branch-performance analytics: TODO (needs the capture warehouse).
5. **Brand + sponsor placement marketplace over live content.** TODO (ad plane = Eyevinn sgai-ad-proxy for
   break ads ONLY; in-scene = render-time beat_variant; see docs/CONTENT_AND_AD_PLANES.md).
6. **Cut-selection A/B to prove lift (the gate).** PARTIAL: propensity logged (decision_log), control
   holdout + IPS/DR OPE built (services/experiment). The live A/B-vs-fixed-cut harness + lift dashboard
   (W10) TODO. Lift gate does NOT block launch - the app stands on accessibility + localization regardless.
7. **Credit-gated be-the-protagonist, then (only if lift proves out) the generative/live frontier.** GATED
   (biometric consent infra, weights, render cost). NWM research track in docs/NARRATIVE_WORLD_MODEL.md.

## The honest tradeoff

Parallel costs more than sequencing - real. Mitigation is structural: shared spine + shared content library
means the second front door is a thin client + its tools, not a second platform. Keep the spine disciplined
and parallel is affordable. Lift stays gated behind proof; ship the affordable cached version, measure, let
data fund the expensive version.
