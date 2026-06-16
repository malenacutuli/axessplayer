# Proposal 0009d: per sign-language video map (`sign_video_urls`)

Status: PROPOSED. Awaiting founder ratification. No migration or contract edit is applied until ratified. No em
dashes.

## Why

0009a added a single `sign_video_url` on `beat_variants`, sized for one sign language (ASL). We now produce more
than one sign language per title: the pipeline extracts real per-word dictionaries (ASL from WLASL sources, PSL
from the sign-language-translator/sign-language-datasets repo) and builds a dialogue-aligned track per language.
The consumer already exposes a sign-language selection panel (ASL, PSL). It needs a contract that carries one
URL per sign language, exactly like `dub_audio_urls` carries one audio URL per spoken language.

Today the player derives sibling tracks client-side (`.../asl_sign.webm` -> `.../<sl>_sign.webm`) as a demo
stand-in. That is fine for the sandbox but should not ship; the real shape is an explicit map.

## Schema delta (additive, nullable)

```sql
-- supabase/migrations/000X_sign_video_urls.sql  (NUMBER TBD at ratification)
alter table beat_variants add column if not exists sign_video_urls jsonb;  -- { "ASL": "https://...", "PSL": "https://..." }
```

`sign_video_url` (singular) stays for backward compatibility and is treated as the default/first sign language
(ASL). When `sign_video_urls` is present it wins; readers fall back to the singular when the map is absent.

## Contract delta

- `PATCH /variants/{id}/tracks` accepts an optional `sign_video_urls` object (string keys are sign-language short
  names: ASL, PSL, BSL, ...; values are URLs). Same handler and validation path as the existing track URLs.
- `GET /series/{id}/graph` returns `sign_video_urls` on each variant alongside `sign_video_url`.

## Client delta

- `signLanguages` derives from `Object.keys(sign_video_urls)` (instead of the hardcoded `["ASL", "PSL"]`).
- `signVideoUrl` is `sign_video_urls[selectedSign]` (instead of the string-replace derivation).
- The selection panel and graceful-absence behavior are unchanged.

## Naming

Keys are the sign-language short names from the program doc (ASL, BSL, LSE, LSM, PSL, ...). "ISL" is banned
(collides across Indian/Israeli/Irish); always the full short name. One key is one distinct language with its
own lexicon and grammar, never a regional skin of another.

## Not in scope

Pose-based rendering, single-signer normalization, and ASL grammar/non-manual markers are Phase 2 (Deaf-led).
This proposal is only the transport for the per-language sign tracks we already produce.
