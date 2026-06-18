# Variant substrate (additive on mobile.beat_variants)

**Contract surface for prompt 13. June 2026. No em dashes.**

Source of truth: docs/product/GOLD_STANDARD_13_VARIANT_SUBSTRATE_AND_EVENTS.md (section 1).

This document specifies the variant substrate fields. A variant is the atomic playable or
processable unit: a master upload, an AI-generated cut, a localized dub, an accessibility track,
an alternate ending, a POV cut, an intensity cut, a brand-integrated cut, or an
archival/adapted-footage cut. The serve path treats all kinds identically (a variant is a
pre-rendered asset, a generation spec, or an adapted source).

## Hard rule: additive only

These fields are ADDITIVE on `mobile.beat_variants` (and linked tables). They MUST be applied with
idempotent `add column if not exists` DDL, never by editing the frozen `supabase/migrations/` or
`contracts/`. The companion script is `scripts/sql/variant_substrate_additive.sql`. That script is
documentation/ahead-of-execution only and is not run by this slice.

## Field catalog

### Identity and routing (already present or linked, listed for completeness)

| Field | Type | Notes |
| --- | --- | --- |
| asset_id | uuid | the underlying media asset |
| series_id | uuid | owning series |
| episode_id | uuid | owning episode |
| beat_id | uuid | owning beat |

### Variant kind and grouping

| Field | Type | Notes |
| --- | --- | --- |
| variant_kind | text | one of `master`, `ai_cut`, `dub`, `a11y`, `alt_ending`, `pov`, `intensity`, `brand`, `adapted`. Enforced by a check constraint. |
| axis | text | the dimension this variant varies along (for example `language`, `pov`, `intensity`, `ending`, `brand`). |
| axis_value | text | the value on that axis (for example `es-419`, `maya`, `tense`, `betrayal`, `acme`). |
| variant_group | text | groups mutually exclusive variants that the serve path chooses between. |

### Localization and accessibility tracks

| Field | Type | Notes |
| --- | --- | --- |
| language | text | BCP 47 language tag of the primary track. |
| caption_doc_url | text | caption/subtitle document. |
| audio_description_url | text | audio description track. |
| sign_video_url | text | sign-language video track. |
| dub_audio_urls | jsonb | map of language tag to dub audio url. |

### Monetization state

| Field | Type | Notes |
| --- | --- | --- |
| is_premium | boolean | default false. |
| coin_cost | integer | cost in coins to unlock; null when free. |
| entitlement_scope | text | scope of the entitlement granted on purchase (for example `variant`, `ending`, `series`). |

### Branch state (story graph)

| Field | Type | Notes |
| --- | --- | --- |
| is_branch_point | boolean | default false; true when this variant presents a choice. |
| branch_edges | jsonb | outgoing edges (target node + condition). |
| branch_conditions | jsonb | memory-variable conditions gating this variant. |
| is_ending | boolean | default false; true when this variant is a terminal ending node. |

### Rights state

| Field | Type | Notes |
| --- | --- | --- |
| rights_ref | text | reference to the rights record. |
| consent_ref | text | reference to the consent record (talent, biometric). |
| royalty_participants | jsonb | participants and their royalty splits. |

### Provenance, C2PA, and Article 50

| Field | Type | Notes |
| --- | --- | --- |
| provenance_id | text | provenance record id. |
| content_credentials | jsonb | content credentials payload. |
| c2pa_signed | boolean | default false; whether a C2PA manifest is attached and signed. |
| c2pa_manifest_url | text | the C2PA manifest. |
| article50_ai_label | text | Article 50 AI-disclosure label state (for example `not_required`, `pending`, `labeled`). |

### Analytics, QA, and playback

| Field | Type | Notes |
| --- | --- | --- |
| analytics_event_mapping | jsonb | the canonical events this variant emits (names from `AxpEventName` in `@axessplayer/analytics-sdk`). |
| qa_status | text | QA gate state (for example `draft`, `in_review`, `approved`, `rejected`). |
| playback_url | text | resolved playback url for a pre-rendered asset. |
| duration | integer | duration in milliseconds. |

## How the surfaces use the substrate

- Viewer (10): reads variants and viewer state to serve a personalized cut; emits every event.
- Admin (11): authors variants and the story graph; manages rights/consent/provenance per variant.
- Studio (12): creator-facing authoring of variants, branches, endings, accessibility, and brand.

The substrate is the seam that future-proofs real-time generation and unifies content,
accessibility, and brand. Additive tables only in the mobile schema; do not edit frozen
`contracts/` or `supabase/migrations/`.
