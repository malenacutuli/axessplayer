# Accessibility features - code backup and restore manifest

A self-contained extract of every source file that implements the four accessibility
features, plus the on-disk data formats they consume. No em dashes.

Generated from branch `feat/adaptive-accessibility-publish`. Files are copied verbatim;
the `Restore path` column is where each belongs in the live tree.

## The four features and where they live

### 1. Captions with Intention (CWI)
Three independent producer signals map to three Roboto Flex axes, per word:
- `energy_rms` (volume) to SIZE (3:5:12 percent ratio, whisper:normal:scream)
- `f0_hz` (pitch) to WEIGHT (higher pitch lighter, 100..1000)
- `harmonic_ratio` (harmonics) to WIDTH (fuller/lower wider, 25..151)
Character color carries identity but never meaning (the speaker NAME tag is the redundant
non-color cue, WCAG 1.4.1 / EN 301 549). Read-ahead states differ by opacity, not hue.
An emotion layer (LLM-tagged) tints the character color and adjusts tracking/italics.

| File | Restore path | Role |
|---|---|---|
| `web/player/a11y/CaptionsWithIntention.tsx` | `apps/web/src/player/a11y/CaptionsWithIntention.tsx` | The 9:16 renderer (box, per-word axes, burst breakout, speaker tag) |
| `web/player/a11y/captionsModel.ts` | `apps/web/src/player/a11y/captionsModel.ts` | Schema (CaptionSegment/CaptionWord/CaptionMeta), CI palette, the 3-axis mapping functions, emotion styles |
| `web/player/a11y/captionsFit.ts` | `apps/web/src/player/a11y/captionsFit.ts` | Pixel-measured two-line pagination so words never overflow the column |

### 2. Dubbing (multi-language audio + matched captions)
Each variant carries `dub_audio_urls` (a `{ lang: url }` map). Selecting a language
switches BOTH the audio (to the dub track) and the captions (to the same-directory
`<lang>_captions.json`) together. Base language is the variant's own.

| File | Restore path | Role |
|---|---|---|
| `web/player/Player.tsx` | `apps/web/src/player/Player.tsx` | Orchestration: `dubLangs`, `dubAudioUrl`, `captionDocUrl` derivation, language switch |
| `web/api/content.ts` | `apps/web/src/api/content.ts` | `VariantNode.dub_audio_urls`, track-URL typing |

### 3. Audio description (AD / EAD)
AD segments carry their own audio + timing. `requiresExtension` means the AD is longer
than the dialogue gap, so the player pauses or slows (extended audio description, WCAG AAA).

| File | Restore path | Role |
|---|---|---|
| `web/player/a11y/audioDescription.ts` | `apps/web/src/player/a11y/audioDescription.ts` | `AudioDescriptionSegment` / `AudioDescriptionDoc` types (incl. extension) |
| `web/player/Player.tsx` | `apps/web/src/player/Player.tsx` | Fetches the AD doc, drives AD playback + the extension behavior |

### 4. Sign language picture-in-picture
A repositionable, resizable PiP that never overlaps the caption safe area or the right
action rail. Plays the selected sign language's `sign_video_url`; a labelled placeholder
when the cut carries no sign track. ASL/PSL/LSA selectable.

| File | Restore path | Role |
|---|---|---|
| `web/player/SignPip.tsx` | `apps/web/src/player/SignPip.tsx` | The PiP component (geometry, side/size toggles, language badge) |

### Shared control + availability surface
| File | Restore path | Role |
|---|---|---|
| `web/a11y/preferences.ts` | `apps/web/src/a11y/preferences.ts` | `A11yPreferences`, accessibility-first defaults, `resolveA11y`, `accessibilityFromVariant` (URL presence is the single source of truth), localStorage persistence |
| `web/a11y/A11ySheet.tsx` | `apps/web/src/a11y/A11ySheet.tsx` | The viewer control sheet (toggles, character-color toggle, sign-language + language chips, graceful "not available" states) |
| `mobile/preferences.ts` | `apps/mobile/src/accessibility/preferences.ts` | The mobile-app parallel of the preference resolver |

### Authoring + production (where tracks come from)
| File | Restore path | Role |
|---|---|---|
| `studio/media.ts` | `apps/studio/src/api/media.ts` | `deriveTrackUrls` / `listTracks`: how Studio discovers a variant's track assets |
| `backend/ingestion/stages.ts` | `services/ingestion/src/stages.ts` | `accessibilityStages(langs, signLangs, baseLang)`: the per-track pipeline stages |
| `backend/ingestion/executors.ts` | `services/ingestion/src/executors.ts` | `stageTrackField` etc.: which DB column each produced track writes to |

## Backend track-registration + provenance path

How a produced track lands on a variant and gets signed. The ingestion DAG produces each
track, the registrar writes its URL through the content service and records C2PA provenance
+ a consent reference through the trust service, and only a provenanced, consented asset is
servable. The real C2PA signer and the consent-ref writes stay behind the founder
consent/provenance go-live gate (`consentProvenanceLive`).

| File | Restore path | Role |
|---|---|---|
| `backend/content/content.ts` | `services/content/src/content.ts` | `setVariantTracks` handler (validates + writes the four track URLs) |
| `backend/content/http-app.ts` | `services/content/src/http/app.ts` | The `PATCH` variant-tracks route |
| `backend/content/pgContentDb.ts` | `services/content/src/pgContentDb.ts` | `setVariantTracks` SQL writer (caption/AD/sign/dub columns) |
| `backend/ingestion/trustRegistrar.ts` | `services/ingestion/src/trustRegistrar.ts` | `registerOne` / `makeProductionRegistrar`: ties a produced track to provenance + consent; gated by `consentProvenanceLive` |
| `backend/ingestion/orchestrator.ts` | `services/ingestion/src/orchestrator.ts` | The idempotent, resumable, cost-gated ingest DAG that drives stage production |
| `backend/trust/trust.ts` | `services/trust/src/trust.ts` | Provenance + consent core; a variant is servable only when both exist |
| `backend/trust/c2pa.ts` | `services/trust/src/c2pa.ts` | C2PA signing (TEST HMAC signer; real KMS cose-sign1 is the cutover) |
| `backend/trust/hashChain.ts` | `services/trust/src/hashChain.ts` | The hash-chained consent ledger |
| `backend/trust/server.ts` | `services/trust/src/server.ts` | Trust HTTP: `POST /provenance`, `POST /consent`, `GET /verify/<id>` |

## Data formats (the files the player fetches)

`formats/captions.sample.json` - the CWI caption document. Top-level `meta` carries the
clip-level `energy` and `f0` percentile calibration (so the axes map across the clip's own
range); `segments[]` each have `speaker`, `speakerColor`, `emotion`, `intent`, and `words[]`
with `f0_hz` / `energy_rms` / `harmonic_ratio` per word. Loader accepts a bare array or
`{ segments, meta }`. Per-language captions live beside it as `<lang>_captions.json`.

`formats/audio_description.sample.json` - the AD document: `segments[]` with `text`,
timing, `audioUrl`, `audioDurationMs`, and `requiresExtension` / `extensionType`.

Sign video: a plain `.webm` clip per sign language (`asl_sign.webm`, `psl_sign.webm`,
`lsa_sign.webm`). These are large binaries and are NOT copied into this backup; in the
running stack they are served at `http://127.0.0.1:8095/media/<assetId>/<lang>_sign.webm`.

## How a variant carries its tracks (DB)

`mobile.beat_variants` (and the public mirror) columns:
- `caption_doc_url`     -> CWI caption document (and the base for `<lang>_captions.json`)
- `audio_description_url` -> AD document
- `sign_video_url`      -> sign PiP clip
- `dub_audio_urls`      -> jsonb `{ lang: url }` map for dubbing

Availability is computed from URL PRESENCE (`accessibilityFromVariant`), never a separate
flag, so the control sheet can never claim a track the cut does not actually carry.

## Restore

Copy each file back to its `Restore path`. The web feature set has no dependencies beyond
React and the repo's existing `api/content.ts` and `api/http.js`. The fonts (Roboto Flex,
Inter) load via `apps/web/src/styles/brand-tokens.css`. To verify end to end, register the
four track URLs on a published variant and open the consumer player; the A11y sheet shows
all four toggles on by default.
