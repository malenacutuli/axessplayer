# social : package instructions

**Viewer prompt 20-V8 (social / community). HIGHEST-RISK, GATED.** Stack: Node + Postgres (mobile overlay
schema). Mirrors the service pattern (node:http on 0.0.0.0, pg search_path=mobile, Bearer session verifier
stub, NODE_ENV=production cutover-gate, CORS-OK permissive handler).

You may write only inside this package. Consume other planes by interface only. Never edit `contracts/`,
`supabase/migrations/`, `render.yaml`, or the original live services. Additive SQL lives at
`scripts/sql/14_social.sql` and is NEVER executed by the build. No emojis, no em dashes.

## Hard gates (non-negotiable)

- **Age-gate**: minors (and an unknown age band, fail-closed) are BLOCKED from mature community content.
  No romantic/parasocial overlap is modelled. See `ageGate.ts` / `ageProvider.ts`.
- **Fail-closed moderation**: EVERY UGC write (post, comment) runs through `runModeration` -> a
  `ScanProvider` BEFORE publish. Writes start `pending`; with NO provider wired the pipeline returns
  `pending_provider` and the content STAYS unpublished (never auto-clean, the opposite of fail-open). Only
  a wired provider returning `clean` yields `approved` (publishable). See `moderation.ts`.
- **Rate limits**: per-user fixed-window limiter trips BEFORE the scanner. See `rateLimit.ts`.
- **Report + moderation queue**: a report enqueues for the human moderation console (the admin console
  already exists); it NEVER auto-removes content. `db.moderationQueue()` is the queue read.
- **Block / mute**: viewer-side safety primitives; hidden authors are filtered from feeds and threads.

## Not deployed

This service is NOT in `render.yaml`. The image builds + typechecks only. Cutover gates (session verifier,
scan provider, age provider) refuse to fake success under `NODE_ENV=production`.
