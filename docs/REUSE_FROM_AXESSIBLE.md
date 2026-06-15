# Reuse from Axessible (mvpsigndemo-20) into Axessplayer

**2026-06-15.** What we can pull from the Axessible video-accessibility platform
(github.com/malenacutuli/mvpsigndemo-20, cloned at /Users/malena/mvpsigndemo-20) into Axessplayer
(/Users/malena/axessplayer). Based on a three-part exploration of its edge functions, database, and
front end. No em dashes.

## The thesis

Axessible already solved three things Axessplayer is missing or faking:
1. **Real video upload** (presigned S3, resumable multipart) - the thing that was not working.
2. **Real accessibility tracks** (captions-with-intention, audio description, sign language, speaker
   color/intensity) - Axessplayer's player A11y sheet only toggles placeholders today.
3. **A transcription + AI pipeline** that produces all of the above from a raw upload, automatically.

These map cleanly onto Axessplayer's `beat_variants` model: a Studio upload becomes a variant's
`playback_url`, and the accessibility tracks attach per variant. The Extended Audio Description feature
(pause/slowdown at moments) even maps onto Axessplayer's branch points.

## The one strategic decision: where does the media/accessibility backend live

Everything reusable assumes **Supabase + AWS S3** plus ~22 API secrets (AssemblyAI, Gemini, ElevenLabs,
Stripe, ...). Axessplayer today runs its own services (content/economy/decision/manifest) on Postgres,
not Supabase Edge. So there are two integration paths:

- **Path A - adopt Supabase as the media subsystem (recommended).** Stand up Axessible's Supabase
  project as Axessplayer's "media + accessibility + upload + billing" backend. Keep Axessplayer's
  adaptive core (bandit, decision, economy, the frozen contracts) exactly as is. The player reads
  playback + accessibility from Supabase and adaptive decisions from the existing services. Fastest, and
  it reuses months of working code (the multi-provider `transcribe` alone is the crown jewel).
- **Path B - port the logic into Axessplayer's own services.** Reimplement the upload presigner,
  transcription orchestration, caption renderer, and AD scheduler against Axessplayer's Postgres +
  services. No Supabase dependency, keeps the contract-first architecture pure, but it is weeks more work
  and re-solves problems Axessible already solved.

Recommendation: **Path A for the media/accessibility/upload/billing subsystem**, Path B never needed for
the adaptive core (it stays). Axessplayer becomes: adaptive core (ours) + media backend (Axessible's
Supabase) + one player that consumes both.

## Edge functions (backend) - what to reuse

| Function | Verdict | Why |
|---|---|---|
| `aws-s3-upload-url`, `s3-multipart-upload`, `validate-upload` | **LIFT** | Real upload: presigned PUT for small files, 3-phase multipart + quota for large. The upload we want. |
| `transcribe` (+ `speaker-diarization`) | **LIFT** | Multi-provider (AssemblyAI -> Deepgram -> Twelve Labs -> Whisper), speaker diarization, free sentiment/intensity. 80% of "accessibility" in one function. |
| `analyze-vocal-intensity` | **LIFT** | Local, zero cost. Drives caption styling (whisper/normal/yell). |
| `ai-generate-chapters` / `-highlights` / `-remove-filler-words` | **ADAPT** | Self-contained Gemini prompts, ~$0.001/call. Adapt table names. |
| `create-checkout`, `stripe-webhook`, `check-subscription` | **LIFT** | Complete Stripe subscription pipeline. Sits ALONGSIDE the coin economy (subscriptions for premium tiers, coins for one-off unlocks). |
| `_shared/rateLimiter.ts` | **LIFT** | Tier-based rate limiting. |

Secrets/cost gate: AWS (S3) + AssemblyAI are the minimum for upload+transcribe; Gemini/ElevenLabs/Stripe
add the rest. All are human-provided secrets (cutover gate).

## Database - adopt/merge/skip (all are SCHEMA changes = sign-off gate)

Attach Axessible's accessibility model to Axessplayer's `beat_variants` (the publishable unit):

| Axessible cluster | Decision | Attaches to Axessplayer as |
|---|---|---|
| Video/asset, `tracks`, `characters` | **ADOPT** | `playback_url` already exists on beat_variants; add `beat_variant_audio_tracks`, `beat_variant_characters`. |
| `transcript_segments`, `audio_descriptions`, `sign_language_clips` | **ADOPT** | New `beat_variant_captions` (word-level timing, speaker color, intensity), `beat_variant_audio_descriptions`, `beat_variant_sign_clips`. |
| AI outputs (`emotion_spans`, generation cache) | **ADOPT** | `beat_variant_emotion`, `beat_variant_generation_cache` (immutable, service-role writes). |
| `profiles` + `subscribers` | **MERGE** | Extend `users` with `stripe_customer_id`, `subscription_tier`, usage/storage fields. Subscriptions coexist with the coin economy. |
| `channels` | **SKIP** (MVP) | Axessplayer's `series`/`episodes` already group content. |
| `usage_records` | **ADOPT** | `user_usage_records` immutable audit, pairs with subscription limits. |
| `jobs` | **ADOPT** | Generalize to polymorphic `background_jobs` for async transcribe/encode. |
| analytics (`public_video_views`) | **MERGE** | Fold into the event spine + `decision_log`; keep the anonymized/privacy-by-design pattern (matches our consent/GDPR work). |

All new tables follow Axessplayer's deny-all RLS + composite-FK discipline. These migrations go through
`docs/proposals/` first (schema is a frozen gate), like the consent schema.

## Front end / player - lift logic, restyle shell

| Piece | Verdict | Note |
|---|---|---|
| Resumable multipart uploader (`r2-upload-enhanced.ts`) + `UploadAccessible.tsx` | **LIFT (restyle)** | Backend-agnostic logic; auto-triggers transcription on upload. Most liftable front-end piece. |
| Caption render engine (`CaptionsWithIntention.tsx`) | **ADAPT** | Logic ports (speaker color, word timing, 7-level intensity); CSS moves from Tailwind/shadcn to brand tokens. |
| Audio Description player + scheduler (`lib/ad/scheduler`, ElevenLabs) | **LIFT logic** | Gap-fill scheduling is pure math. **Extended AD pause/slowdown maps onto Axessplayer branch points.** |
| Sign-language inset (`SignLanguageAvatar.tsx`) | **ADAPT** | Keyword -> clip lookup; swap demo clips for a real ASL library. |
| i18n (`i18next`, 8 languages) | **LIFT + extend** | Add RTL for Arabic. |
| Editors (transcript, character) | **REBUILD** | Too shadcn/Supabase-coupled; rebuild on Axessplayer patterns. |

Dependency cost: adopting the player pulls in `@supabase/supabase-js`, ElevenLabs, `i18next`, `sonner`,
and a restyle off Tailwind/shadcn onto the brand tokens. The adaptive player UI we already built stays;
we graft the real accessibility rendering into it.

## Sequenced plan (each slice gated where noted)

1. **Real upload (highest priority, fixes the live complaint).**
   - Now, no gate: a local upload loop (media server) so you can upload an MP4 in the Studio and watch it.
   - Real version (gate: AWS creds): point the same client at `aws-s3-upload-url`. Same client shape.
2. **Transcription -> accessibility tracks** (gate: Supabase + AssemblyAI). Upload auto-transcribes;
   captions/AD/intensity land per beat_variant. Schema additions via `docs/proposals/`.
3. **Real accessibility in the player.** Graft `CaptionsWithIntention` + AD scheduler into the
   Axessplayer dark player, restyled to brand tokens. The A11y sheet stops faking.
4. **Subscriptions alongside coins** (gate: Stripe). `create-checkout` + `stripe-webhook` for premium
   tiers; coins stay for one-off unlocks.
5. **AI assists** (gate: Gemini/ElevenLabs). Chapters/highlights/filler/vocal-intensity in the Studio.

## What I can start now without any gate

The local upload loop in the Studio (media server + preview + plays in the consumer player). It is the
same client-side shape that later points at `aws-s3-upload-url`, so it is not throwaway. Everything past
slice 1 needs the Supabase/AWS/Stripe decision + secrets.
