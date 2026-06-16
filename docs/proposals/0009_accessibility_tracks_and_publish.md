# Proposal 0009: real accessibility tracks + publish state and feed

Status: PROPOSED. Awaiting founder ratification. No migration or contract edit is applied until ratified. No em
dashes.

This proposal covers two gated pieces in one pass so they are approved together:

- **0009a** real accessibility track URLs on `beat_variants` (caption document, AD audio, sign video, per-language
  dub audio), plus the content-service path to set and read them. This wires Axessible's already-built
  accessibility engine into axessplayer variants. Reuse, not rebuild.
- **0009b** publish state and feed: a `published_at` column on `series` (and `episodes`), a content route to flip
  it, a feed read filtering to published series, and the consumer feed UI. This makes the existing Publish
  button's "Publish to feed" a real go-live instead of a no-op.

The engine that produces these assets already exists in the Axessible repo (mvpsigndemo): ~70 edge functions
including `transcribe`/`transcribe-with-deepgram`, `twelve-labs-audio-descriptions`,
`generate-visual-descriptions`, `translate-audio-description`, `tts`, `generate-dubbing`, `generate-lipsync`,
real ASL clips, and the captions-with-intention renderer. 0009a is the contract for the hand-off between the
two repos the founder owns.

---

## 0009a. Real accessibility track URLs

### Schema delta (additive, nullable)

```sql
-- supabase/migrations/0007_variant_track_urls.sql  (NUMBER TBD at ratification)
alter table beat_variants add column if not exists caption_doc_url   text;   -- word-level captions-with-intention JSON
alter table beat_variants add column if not exists audio_description_url text; -- AD audio track (mixed, ducked)
alter table beat_variants add column if not exists sign_video_url     text;   -- ASL sign-language video (e.g. webm)
alter table beat_variants add column if not exists dub_audio_urls     jsonb default '{}'::jsonb; -- { "es": url, "fr": url, ... }
```

Rationale: four nullable columns rather than a child table keeps the variant read a single row and matches the
existing `accessibility jsonb` / `placement_slots jsonb` style. `dub_audio_urls` is a per-language map so the
language chips can offer exactly the dubs that exist (the screenshot's "No content available for dubbing" is
precisely an empty map).

### Contract delta

`contracts/api/content.yaml` (frozen, W0 to apply on ratification):
- Extend `createVariant`'s documented body with the four optional fields.
- Add `PATCH /variants/{variant_id}/tracks` (operationId `setVariantTracks`) so Axessible's pipeline (or the
  Studio) can attach track URLs to an existing variant after the encode lands, without recreating the row.
- `GET /series/{id}/graph` returns the four fields on each variant (additive; consumers ignore unknown fields).

Service work (mirrors the 0008 delete pattern): `handleSetVariantTracks`, `ContentDB.setVariantTracks`, the
PgContentDb + harness adapters, a route, the graph read selecting the new columns, and the client
`setVariantTracks`. The Studio Media panel inspector grows four URL fields (or an "Attach from Axessible"
action). The player renders real tracks via the modules lifted from Axessible (see the vertical directive,
Section 3): captions-with-intention renderer, AD audio mixer with dialogue ducking, sign PiP, dub switcher.

### Migration plan
1. Apply `0007_variant_track_urls.sql` to the local dev DB and to staging (Supabase faeyekynudyzeotbjfsj) only
   after ratification.
2. Ship the service + contract together; the columns are nullable so existing variants are valid (all tracks
   null = today's flag-only behavior, no regression).
3. Backfill is optional and per-series, driven by Axessible's pipeline.

### Rollback
Columns are additive and nullable; rollback is `alter table beat_variants drop column ...` for the four
columns. No data loss for existing playback because `playback_url` is untouched.

### Acceptance (B, from the vertical directive)
One vertical beat plays with a real caption document (word-level, at least one character color and one
emphasis), a real AD track ducking dialogue, a real sign video in the vertical-safe PiP, and a real dub in one
non-English language from the chips. Evidence: the beat playing each track and the variant row showing the four
URLs populated.

---

## 0009b. Publish state and feed

### Schema delta (additive, nullable)

```sql
-- supabase/migrations/0008_series_publication.sql  (NUMBER TBD at ratification)
alter table series   add column if not exists published_at timestamptz; -- NULL = draft, set = live
alter table episodes add column if not exists published_at timestamptz; -- optional per-episode rollout
create index if not exists idx_series_published on series (published_at);
```

NULL means draft; a timestamp means live. Unpublish sets it back to NULL. Episode-level `published_at` supports
rolling out episodes within a published series (optional; series-level alone is enough for the MVP feed).

### Contract delta

`contracts/api/content.yaml` (frozen, W0 to apply on ratification):
- `POST /series/{id}/publish`   (operationId `publishSeries`)   -> 200 `{ id, published_at }`, 404 series_not_found.
- `POST /series/{id}/unpublish` (operationId `unpublishSeries`) -> 200 `{ id, published_at: null }`, 404.
- `GET /feed` (operationId `getFeed`) -> 200 `{ series: FeedItem[] }`, published only, newest first.
- `GET /series/{id}/graph` returns `published_at` on the series (additive).

Service work: `handleSetSeriesPublished`, `handleGetFeed`, `ContentDB.setSeriesPublished` +
`listPublishedSeries`, both adapters, the routes, and the graph read selecting `published_at`. Studio: client
`publishSeries`/`unpublishSeries`; the Publish panel's "Publish to feed" calls the real route, shows live state
and a timestamp, and offers Unpublish (idempotent). Consumer: a feed screen reads `GET /feed` and lists
published series (today it loads one hardcoded seriesId).

### Migration plan
1. Apply `0008_series_publication.sql` to local dev, then staging, only after ratification.
2. Ship service + contract together. The column is nullable, so every existing series defaults to draft (not
   surprise-live).
3. Publish the seeded "The Last Signal" as the first feed entry to prove the path.

### Rollback
`drop index idx_series_published; alter table series drop column published_at; alter table episodes drop column
published_at;`. The Publish button reverts to its no-op state. No other data affected.

### Acceptance
Publishing the seeded series via the Studio Publish panel writes `published_at`, `GET /feed` returns it, and the
consumer feed shows it and plays it; Unpublish removes it from the feed. Evidence: the publish call + response,
the `/feed` rows, the consumer feed showing the series, and the unpublish removing it.

---

## Boundary and sequencing

- Ungated and already in progress: the player's vertical 9:16 adaptation (Work item A of the vertical
  directive). No schema or contract. Proceeds independently of this proposal.
- Gated by this proposal: 0009a real tracks and 0009b publish + feed. No migration, no `contracts/` edit, until
  the founder says go.
- On ratification, the migration numbers above are assigned to the next free `supabase/migrations/` slots and
  the contract deltas are folded into `contracts/api/content.yaml` by W0, then the service + Studio + consumer
  work ships behind the new contract.

Supersedes the local-only publish migration that was briefly applied and then reverted (the column was dropped
and the migration file removed) once this gate was clarified.
