# Prompt 28: the reading platform (product + demand sensor)

**Builds the READ surface. Scoped as the demand sensor and IP origination engine, not a Wattpad clone. June 2026. No em dashes.**

Source of truth: GOLD_STANDARD_17 (North Star) and the Definitive Platform Blueprint. Build on the existing stack and
the shared spine. Do NOT introduce new heavy infrastructure. Stay on Supabase Postgres.

## Why this exists
Holywater's My Passion (e books) feeds My Drama: 30 percent of video hits are adapted from winning text. Reading is
the cheapest top of the funnel, the origination of owned IP, the lowest cost creator acquisition channel, and the
demand sensor that de risks every expensive video. This prompt builds it as a real consumer product that is
simultaneously that sensor. Keep it focused.

## Data model (sibling of the video model, one substrate)
Add to the mobile schema, reusing patterns from beats/beat_variants:
- `works` (a story): id, title, synopsis, genre, language, base_language, available_languages, cover, author_id,
  origin (creator_self_publish | editorial | in_house), status, published_at, consent_ref, provenance_id.
- `chapters` (installments): work_id, index, title, body_ref (text storage), is_free, coin_cost, published_at,
  accessibility (dyslexia layout flags, audio_edition_url, screen_reader_ready).
- `reading_state`: user_id, work_id, chapter_index, percent, updated_at (the per reader progress, a sibling of
  viewer_state).
- `adaptation_candidates`: work_id, demand_score, signals (completion, re reads, shares, finish rate by cohort),
  status (testing | ready_to_adapt | adapting | adapted), linked_series_id (FK to mobile.series when graduated).
Reuse consent_ledger, content_credentials, coin_wallet, coin_transactions, entitlements, engagement_events.

## The demand sensor (the point)
Point the EXISTING engagement and outcome pipeline at reading behavior. Compute a per work demand_score from
completion, re read rate, share rate, finish velocity, and how it indexes by audience and market. Surface
`ready_to_adapt` works in the Studio with the evidence. This is the same outcome engine as video, not a new system.

## Surfaces to build
- Reader app (in apps/mobile and apps/web, sharing the design system, prompt 24): a BookTok style discovery feed,
  a work page, a clean reading view (typography first, dyslexia friendly option, audio edition toggle, full screen
  reader support), serialized daily installments, coin unlock and subscription, a "this could become a series"
  follow.
- Studio additions (prompt 22): self publish flow (write or upload a serialized work, keep 70 percent, own the IP,
  consent and provenance applied), and the `ready_to_adapt` demand dashboard with a one click "adapt to series" that
  seeds a mobile.series + beats from the work.
- Editorial intake: an admin path (prompt 21) to onboard publisher and editorial catalog with rights and consent.

## Accessibility first (the wedge, do not skip)
Accessible reading is a differentiator: dyslexia friendly typography option, full screen reader semantics, and an
audio edition on by default where rights allow. Reach the readership Wattpad and Inkitt ignore.

## Consent and provenance
Every work carries a consent_ledger entry and C2PA style provenance; AI assisted writing is labeled. Editorial and
creator rights are recorded before publish. This is what makes the IP cleanly adaptable and the data legally usable.

## Graduation to video (close the flywheel)
"Adapt to series" takes a ready_to_adapt work and seeds the video beat graph from its chapters, so the same story
moves text to video inside one data structure, carrying its consent and provenance forward.

## Definition of done (MVP)
A reader can discover, unlock and read a serialized work with accessibility on by default; reading behavior flows
into engagement_events and produces a demand_score; the Studio shows a ready_to_adapt work with its evidence and can
seed a video series from it; consent and provenance are attached. Do NOT build social graph, messaging, or a full
community system yet. Keep it the funnel.

## Out of scope for now
Full community/social, creator messaging, gamified reading streaks beyond the existing economy, recommendation
beyond the existing recommender. These come after the funnel proves out.
