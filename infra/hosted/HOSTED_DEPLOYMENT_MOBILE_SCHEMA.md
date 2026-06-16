# Hosted deployment: axessplayer mobile app on the shared Supabase project

**Status: DONE and verified. June 2026. No em dashes.**

The adaptive-cinema mobile app now lives in an isolated `mobile` schema inside the existing axessplayer.com
web Supabase project, so it reuses every secret, the S3/R2 upload functions, the AD/dubbing/TTS edge functions,
and the live Stripe billing stack, with no second database to pay for and zero collision with the web product.

## What was applied

- Project: `faeyekynudyzeotbjfsj` (the axessplayer.com web product DB).
- A new schema `mobile` holding the app's 13 tables and 2 ledger functions (`spend_coins`, `grant_coins`).
- Source: `infra/hosted/mobile_schema_deploy.sql` (tables + additive columns) then
  `infra/hosted/mobile_schema_functions.sql` (ledger). These are a deployment transform of frozen migrations
  0001-0008: the only change is `public.*` retargeted to `mobile.*` in the ledger functions. The canonical
  `supabase/migrations/*` are NOT edited and stay public-schema for local dev. 0002 is omitted (0003 supersedes it).
- The F2 security lock is preserved exactly: both functions still run `SET search_path = ''` with every object
  fully `mobile.`-qualified, and EXECUTE is revoked from PUBLIC/anon/authenticated and granted to service_role only.

## Verification (run at apply time)

- Ledger: grant 100, spend 30 -> wallet `70+0`, exactly 2 transactions, 1 entitlement. Duplicate same-txn spend
  and a second purchase of owned content were both no-ops. Overspend -> `insufficient_funds`. No-double-spend holds.
- `mobile`: 13 tables, 2 functions.
- `public` untouched: profiles 17, subscriber_access_audit 19948, table count 61 (all unchanged from baseline).
- Test fixtures deleted after the run.

## How the app connects (service wiring)

The axessplayer services (economy, decision, content, manifest) and the web/Studio apps connect to this project
and must resolve unqualified names to `mobile`. Two rules:

1. Set the search path PER CONNECTION on the app's pool, never globally (a global change would affect the web
   product). In the pg pool config use connection options:
   `options=-c search_path=mobile,public`
   The ledger functions are immune (they hard-set `search_path=''` and self-qualify), but every other query in
   the services uses unqualified table names and needs `mobile` first on the path.
2. Use the project's existing service role / DATABASE_URL. The hosted connection string is
   `postgres://postgres:<password>@db.faeyekynudyzeotbjfsj.supabase.co:5432/postgres` for session mode, or the
   pooler host on 6543 for transaction mode. The password and service_role key come from the Supabase dashboard
   or the repo secret. NEVER commit them. Set them as env/secrets only.

Env to set for the services and apps (values from the Supabase dashboard, not in git):
```
DATABASE_URL=postgres://postgres:<password>@db.faeyekynudyzeotbjfsj.supabase.co:5432/postgres?options=-c%20search_path%3Dmobile%2Cpublic
SUPABASE_URL=https://faeyekynudyzeotbjfsj.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from dashboard>
```

## Reuse, do not rebuild

Reuse these existing project capabilities instead of standing up new ones:
- Storage / upload: the R2/S3 edge functions (`generate-r2-upload-url`, `complete-r2-upload`,
  `generate-upload-url`, `s3-multipart-upload`, etc.) and the project storage buckets.
- Accessibility: `generate-ad`, `generate-ad-audio`, `generate-dubbing`, `tts`, `transcribe`,
  `translate-audio-description`, speaker diarization. These can produce or back the 0009a track URLs.
- Billing: the Stripe stack (`create-checkout`, `customer-portal`, `stripe-webhook`, `check-subscription`).
  Stripe is LIVE on this project: do NOT create live products or charges from tooling.

## Re-running

The two SQL files are idempotent for tables/columns (IF NOT EXISTS) and CREATE OR REPLACE for functions, except
the two ADD CONSTRAINT lines in the functions file, which error if already present. To re-apply cleanly, drop and
recreate: `DROP SCHEMA mobile CASCADE;` then run `mobile_schema_deploy.sql` and `mobile_schema_functions.sql`.
Dropping `mobile` never touches `public`.
