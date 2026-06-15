# Path A provisioning: what to provide to wire the real media backend

**Decision: Path A** - adopt Axessible's Supabase + S3 as Axessplayer's media/accessibility/upload/billing
backend; keep the adaptive core (content/economy/decision/manifest, the frozen contracts) as is. This file
lists exactly what a human must provision and hand over, in priority order, so each slice can be wired. The
orchestrator never creates these accounts or holds the secrets; they go into env (Supabase/Vercel/CI), and
the code that consumes them is built around them. No em dashes.

## Already working WITHOUT any of this (the gate-free slice)
Real upload-and-watch runs locally today via tools/media-server (see the Studio Media panel). The upload
client (apps/studio/src/api/media.ts `uploadMaster`) is shaped to re-point at S3 with a one-line base-URL
swap, so nothing below is throwaway.

## Slice 1: real S3 upload (replaces the local media server)
Provide:
- An AWS account + an S3 bucket for masters (name -> `S3_UPLOAD_BUCKET`), region (`AWS_REGION`).
- An IAM key pair scoped to that bucket: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
- The bucket CORS allowing PUT from the app origins.
Then I: deploy the `aws-s3-upload-url` (+ `s3-multipart-upload`, `validate-upload`) edge functions, and
swap `uploadMaster` to call the presigner and PUT to S3. The Studio and consumer player are unchanged.

## Slice 2: transcription -> real accessibility tracks
Provide:
- A Supabase project (or confirm reuse of the Axessible one): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_ANON_KEY`.
- A transcription key: `ASSEMBLYAI_API_KEY` (primary; the others are optional fallbacks: `DEEPGRAM_API_KEY`,
  `TWELVE_LABS_API_KEY`, `OPENAI_API_KEY`).
Then I: apply docs/proposals/0007_beat_variant_accessibility.sql.proposed (after sign-off), deploy the
`transcribe` (+ `speaker-diarization`, `analyze-vocal-intensity`) functions, and on upload auto-transcribe
into beat_variant_captions / _audio_descriptions per variant.

## Slice 3: real accessibility in the player
No new secrets. I graft the `CaptionsWithIntention` renderer + AD scheduler from Axessible into the
Axessplayer dark player, restyled to the brand tokens, reading the slice-2 tables. The A11y sheet stops
faking. Extended AD pause/slowdown wires to branch points.

## Slice 4: subscriptions alongside coins
Provide: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (the LIVE Axessible Technologies account is a re-confirm
gate per the cutover checklist). Then I: deploy `create-checkout` + `stripe-webhook` + `check-subscription`,
add the users subscription columns (in 0007), keep coins for one-off unlocks.

## Slice 5: AI assists (optional)
Provide: `GOOGLE_GEMINI_API_KEY` (chapters/highlights/filler), `ELEVENLABS_API_KEY` (AD TTS). Then I deploy
those edge functions into the Studio.

## Full secret inventory (by slice)
| Secret | Slice | Notes |
|---|---|---|
| AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_UPLOAD_BUCKET | 1 | S3 upload |
| SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY | 2 | media backend |
| ASSEMBLYAI_API_KEY (+ DEEPGRAM/TWELVE_LABS/OPENAI optional) | 2 | transcription |
| STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET | 4 | subscriptions (LIVE = re-confirm gate) |
| GOOGLE_GEMINI_API_KEY, ELEVENLABS_API_KEY | 5 | AI assists |

## Gates (do not cross without a human go)
- Apply 0007 schema (move from docs/proposals to supabase/migrations) only after sign-off.
- Create LIVE Stripe products / charges only on explicit approval (acct_1RvN9wCAKg7jOuBK).
- Any prod deploy / DNS / secret value entry is human-performed.
