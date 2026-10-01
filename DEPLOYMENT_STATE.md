# DEPLOYMENT_STATE.md

Recovered live state of the Axessplayer / REELM platform, verified against the repos. Audit date: 2026-10-01.
Method: read-only CLI and API inventory (supabase CLI v2.90, Vercel API, gh, dig, curl GET). Secret NAMES only.
Where docs and the live system disagree, the live system wins and the conflict is listed in the drift summary.

Read-only note: the Supabase CLI's `db query --linked` initialises its standard temporary CLI login role on the
project. That is the only write the audit caused. An `e2e-matrix` test run was started locally and stopped once it
was found to target the live Render services; every request returned 503 (services suspended), so nothing reached
production.

## 0. The one-paragraph picture

The platform is two repos on one production Supabase project (`faeyekynudyzeotbjfsj`, "Axessible Vimeo", Zurich).

- **mvpsigndemo-20 (Lovable)** is the accessibility product (Zone 1, `public` schema). It serves **axessplayer.com**,
  and **axessible.ai 302-redirects there**.
- **axessplayer (this repo, branch `feat/adaptive-accessibility-publish`)** is the microdrama platform. It uses the
  `mobile` and `axess_v2` schemas on the same project.
  - Its web app is on Vercel at **humanaxess.com**.
  - Its 14 backend services are on **Render, and all 14 are suspended**.
- Storage is Supabase Storage plus Cloudflare R2 (served from `*.r2.dev`).
- There is no transcode, no ABR, no CDN and no signed playback.
- Staging (`olfdwochbqhglwasejoc`) is empty.

## 1. Repo and build baseline (A1)

| Item | Result | Evidence |
|---|---|---|
| axessplayer branch | `feat/adaptive-accessibility-publish` @ `31c22b7`, last commit 2026-06-22. 133 commits ahead of `main` (2026-06-15), 0 behind | `git rev-list` |
| Other branch | `build/reconciled-production-plan` (2026-06-16), contained in feat | |
| Install / gen / build / typecheck | **green** | `pnpm install --frozen-lockfile`, `pnpm gen`, `pnpm build`, `pnpm typecheck` all exit 0 |
| Tests | **475 pass, 14 fail.** All 14 failures are `tests/e2e-matrix`, which calls the live Render services (suspended, 503) | `turbo run test --concurrency=1` |
| mvpsigndemo-20 | `main` @ 2026-06-21. Unmerged: `feature/gitignore-env`, `feature/archive-edge-functions` (2026-07-14/15) | `git for-each-ref` |
| mvpsigndemo-20 build | green with `bun install --frozen-lockfile && vite build`. **`npm ci` fails** (ERESOLVE react-day-picker vs date-fns 4) | build logs |
| Supabase ref | `src/integrations/supabase/client.ts` reads `VITE_SUPABASE_URL`. Committed `.env` and `supabase/config.toml` point at **prod `faeyekynudyzeotbjfsj`** (confirmed, no STOP) | mvpsigndemo-20 |

Monorepo layout (feat): `apps/` (web, studio, admin, mobile, marketing), `services/` (content, decision, economy,
manifest, monetization, identity, catalog, library, experiment, ingestion, admin-api, events, recap, brand,
generation, trust and others), `packages/` (player-sdk, observability, kv, contracts, ui, analytics-sdk), `contracts/`,
`supabase/migrations/` (8), `tools/media-server`, `tests/e2e`, `tests/e2e-matrix`, `render.yaml`.

## 2. Supabase (A2)

### Production `faeyekynudyzeotbjfsj` (Postgres 17.6, Zurich)

| Item | Live | Matches repo? | Drift / gap |
|---|---|---|---|
| Edge functions | **85 ACTIVE** | mvp repo has 63, all deployed | **22 live functions have no source in any repo** (list below). Source downloaded for review, not committed |
| `verify_jwt=false` | 11: aws-s3-upload-url, check-usage-alerts, embed-analytics, fix-ad-languages, generate-lipsync, get-subscription-info, premium-ai-health, send-demo-request, send-signup-notification, send-usage-warning, stripe-webhook | config.toml lists only 5 | 6 more are open live than config.toml declares |
| `public` schema | 60 tables, **RLS on all 60**. 45 policies with `true` condition: 43 are service_role-only (fine), 2 are public SELECT on reference data (caption_templates, cwi_palette) | yes | none material |
| `mobile` schema (axessplayer) | 38 tables. RLS on 36. **RLS off: `mobile.channels`, `mobile.series_channels`**. Not in PostgREST `db_schemas`, and anon/authenticated have USAGE but no table grants | partly (8 numbered migrations, others applied out of band) | reached by services via `DATABASE_URL` (service connection) |
| `axess_v2` schema | 16 tables, **RLS off on all 16**. No anon/authenticated USAGE and not API-exposed | no migration in either repo | origin unversioned |
| Migrations | **180 applied** (latest `20260622102603 reading_works_storage_policy`) | mvp repo 165 files. Versions differ by about 1s (Lovable re-stamping), so they can't be reconciled by version. ~22 axessplayer migrations (2026-06-14..22) were applied by name and are not in repo by version | migration history must be reconciled with `db pull` before any new migration |
| Storage buckets | 11. **PUBLIC:** videos (134 objects), thumbnails (216), processed-videos, sign_language_clips (53), sign-language-clips, audio-descriptions (131), dubbed-audio (15), social-clips. Private: tracks, exports, Axessvideo | | two near-duplicate sign-language buckets |
| Storage anon WRITE | **`axessplayer_qa_insert_masters` / `_update_masters`: anon INSERT and UPDATE on `videos/axessplayer/**`**. `reading_works_anon_insert`: anon INSERT on `thumbnails/works/**` | recorded in commit df0010d | anyone on the internet can upload to the public prod bucket |
| Security advisors | 70x anon-executable SECURITY DEFINER functions, 70x authenticated-executable, 14x mutable search_path, 2x extension in public | | |
| pg_cron | `reset-monthly-usage` (daily 00:00), `check-usage-alerts-daily` (09:00) | | **`cleanup_old_rate_limits` not scheduled** |
| Rate-limit fns | check_rate_limit, get_rate_limit_status, log_rate_limit_violation, cleanup_old_rate_limits exist | yes | only 1 of 63 repo functions calls it (`transcribe`) |
| Backups | daily PHYSICAL backups, latest 2026-10-01 03:14 UTC | | PITR not confirmed. No DR runbook |
| Secrets (names) | 48. R2: CLOUDFLARE_R2_ACCESS_KEY_ID, _ACCOUNT_ID, _BUCKET_NAME, _ENDPOINT, _SECRET_ACCESS_KEY (all 4 the brief named, plus ACCOUNT_ID) | | **Referenced but missing:** INTERNAL_SIGNUP_AUTH_KEY, MAPBOX_PUBLIC_TOKEN, REPLICATE_API_TOKEN (mvp repo). Live R2 functions also reference CLOUDFLARE_R2_PUBLIC_URL and CLOUDFLARE_R2_AXESSPLAYER_BUCKET (**not set**, so they fall back to hardcoded `axessplayer-masters` and a hardcoded `pub-…r2.dev` URL). Duplicates: STABILITY_AI_API_KEY/STABILITY_API_KEY, TWELVELABS_API_KEY/TWELVE_LABS_API_KEY |

**Live functions not in any repo (22):** ai-assistant, axess-signapse-probe (returns 410), axessplayer-ltx-video,
axessplayer-r2-presign, axessplayer-r2-upload, axessplayer-runway-video, axessplayer-seedance-video,
axessplayer-stitch, complete-multipart, consolidate-speakers, generate-upload-url, intelligent-speaker-detection,
manage-subscription, premium-ai-generate, premium-ai-health, premium-ai-publish, premium-ai-repurpose,
premium-ai-write, premium-transcribe, upload-direct-to-s3, video-ai-assistant, video-analysis-workflow.

The brief listed several of these (premium-*, ai-assistant, video-ai-assistant, R2 multipart) as "deployed". They
are, but they are unversioned.

### Staging `olfdwochbqhglwasejoc` (West EU, Ireland)

0 edge functions, no `supabase_migrations` schema, 1 secret. **Not a usable staging environment.**

## 3. Cloudflare (A3): NOT VERIFIED LIVE

wrangler is not logged in (`wrangler whoami`: Not logged in), so the account could not be inventoried. Inferred from
code and secrets only:

- R2 is in use. Secrets are present.
- Buckets referenced in code:
  - `axessplayer-masters` (hardcoded default in axessplayer-r2-presign / r2-upload)
  - the shared Axessible bucket (`CLOUDFLARE_R2_BUCKET_NAME`)
- Public delivery is via **`pub-….r2.dev`** URLs, hardcoded in 2 functions and `_shared/r2-config.ts`. Cloudflare
  docs: r2.dev "is rate-limited and should only be used for development purposes."
- No custom R2 domain, CDN cache rules or Cloudflare Stream usage was found in code.
- axessible.ai and axessplayer.com sit behind Cloudflare (`server: cloudflare`, Lovable edge).

To verify: run `wrangler login`, then `wrangler r2 bucket list` and `wrangler r2 bucket domain list <bucket>`, and
check Stream in the dashboard.

## 4. Frontend hosting (A4)

| Surface | Host | Domain | Last prod deploy | State |
|---|---|---|---|---|
| Accessibility product + "Axessplayer · Adaptive cinema" landing (mvpsigndemo-20) | **Lovable** (185.158.133.1, Cloudflare edge) | **axessplayer.com**, www. DNS at IONOS | Lovable sync from `main` | 200 |
| axessible.ai | Lovable/Cloudflare | **302 → https://axessplayer.com/** | | redirect |
| axessplayer web (`apps/web`) | Vercel `axessplayer-web` | **humanaxess.com** (A 76.76.21.21, DNS IONOS), axessplayer-web.vercel.app | **2026-06-17, manual CLI deploy** | 200. **Every git build of feat since then is ERROR** (10 of 10 checked, latest 2026-06-22) |
| studio | Vercel `axessplayer-studio` | axessplayer-studio.vercel.app | 2026-06-20 (manual) | 200 |
| admin | Vercel `axessplayer-admin` | .vercel.app | 2026-06-18 | |
| viewer-next | Vercel `axessplayer-viewer-next` | .vercel.app | 2026-06-18 | |
| gallery | Vercel `axessplayer-gallery` | .vercel.app | 2026-06-18 | |
| legacy | Vercel `axessible`, `axessible-frontend` | .vercel.app | 2025 | stale |

The docs' domain plan (`DEPLOY_RUNBOOK.md:49-53`: axessplayer.com → marketing, app.axessplayer.com → web,
studio.axessplayer.com → studio) is **not what is live**.

Also in the same Vercel team, and unrelated to this project: swissbrain-ai, swiss-ai-vault*, staging-test.

**Backend services: Render (`render.yaml`, region oregon, plan starter).** All 14 hosts return
`503 Service Suspended` (`x-render-routing: suspend`): content, manifest, decision, economy, events, settlement,
recap, library, ingestion, identity, experiment, catalog, brand, admin-api. **The streaming product currently has no
working backend.** Why they were suspended (billing or manual) is unknown; only the Render dashboard can say.

## 5. CI/CD (A5)

| Workflow | Repo | What it does | Status | Why |
|---|---|---|---|---|
| ci.yml | axessplayer | install, contracts, gen, typecheck, lint, turbo test, ledger concurrency/hardening, e2e-acceptance | **failing** on feat (latest 2026-06-22) | Failing steps: `turbo run test` and `e2e-acceptance`. **The pnpm duplicate is already fixed on feat (b56e98f)**; it still breaks `main`. Turbo tests include `e2e-matrix`, which calls live Render (suspended). |
| deploy.yml | axessplayer | builds 10 Docker images (push only if REGISTRY_TOKEN), Vercel preview if VERCEL_TOKEN | success (it runs as a no-op without secrets) | **Does not deploy Supabase functions** (the brief's claim is wrong). One VERCEL_PROJECT_ID secret is shared by web and studio, so whichever runs second deploys to the wrong project |
| Vercel git integration | axessplayer-web | builds every push | **ERROR on every feat build** | build log not retrieved; next step is `vercel inspect` on one deployment |
| main.yml | mvpsigndemo-20 | mirrors `main` to gitlab.bjaland.co | success | **hardcoded GitLab token in a PUBLIC repo** (revoke and rotate) |
| Lovable | mvpsigndemo-20 | `main` sync = production deploy of axessplayer.com | implicit | no gate |

## 6. Streaming pipeline (A6)

Traced end to end; file:line references are from feat.

1. **Upload.** `apps/studio/src/api/uploadRouter.ts:44-58` tries `axessplayer-r2-presign`, then `axessplayer-r2-upload`
   (large files), then Supabase TUS into the public `videos` bucket.
   - Both R2 clients send the **anon key as Bearer** (`r2FastUpload.ts:24`, `r2Upload.ts:53`).
   - The live functions do **no user auth**, use CORS `*`, and enforce no size or type limit. Up to 10,000 presigned
     parts with a 1 hour expiry.
2. **Encode.** The only HLS encode is `tools/media-server/server.mjs:56-69`:
   - libx264 veryfast, profile main, AAC stereo, `hls_time 4`, VOD, **MPEG-TS** segments
   - source resolution and CRF 23, **one rendition and no ABR ladder** (`master.m3u8` is really a media playlist)
   - output to **local disk**, jobs kept in an in-memory Map
   - header says "NOT for production"; it is not in `render.yaml`. **Production transcode: absent.**
   - Separate path: `axessplayer-stitch` sends clips to Rendi, which produces 720x1280 24fps H.264 with **no audio**,
     re-hosted to Supabase with the service-role key.
3. **Manifest.** `services/manifest` uses `InMemoryManifestDB` with `cdn.example` fixtures (`server.ts:47`).
   - It synthesizes fMP4 names (`{stem}_{i}.m4s`) that match neither the media-server output nor R2.
   - `CDN_ORIGIN` is read nowhere in code.
   - **The manifest service is not on the playback path.**
4. **Player (web).** `Player.tsx:1327-1346` attaches `variant.playback_url` directly via hls.js (`hls.ts:61`, no token).
   - `isPlayableVideoUrl` (`Player.tsx:1065`) rejects CDN `.m3u8` URLs without `/media/`. Studio accepts them, so the
     two have drifted.
   - **Mobile has no player** (`PlayerScreen.tsx:48` is a placeholder).
5. **Actual playback today:** raw masters or Rendi mp4 files, played progressively from public r2.dev or public
   Supabase URLs.
6. **SSAI / ads:** `services/brand/src/demand.ts:47-85` is a stub adapter only, by design.
7. **CDN pre-warm:** `services/generation/src/cdn.ts` is an interface plus `FakeCdnClient`.

## 7. Rate limiting, observability, security, ops (A7)

| Capability | axessplayer | mvpsigndemo-20 / Supabase |
|---|---|---|
| Error tracking | absent | absent |
| Structured logs | partial: `packages/observability` exists but **is imported by no service** | partial: 6 of 63 functions |
| Metrics | absent (package unused) | absent |
| Health checks | partial: `/healthz` on ~9 services. Missing on economy, decision, manifest, library, recap and others. No `healthCheckPath` in render.yaml | absent |
| Uptime / alerting | absent (admin shows hardcoded "99.98%") | absent (`check-usage-alerts` is usage email, not uptime) |
| Security headers / CSP | absent (vercel.json has no headers; ACAO `*` on services). humanaxess.com sends HSTS only | ineffective (meta `frame-ancestors *` is ignored by browsers) |
| Signed media URLs | absent | partial (exports only) |
| Auth | **stub**: services accept unsigned `session:<uuid>`. Web uses `demo-session-token`. Studio auth is local. Gated services refuse to start with NODE_ENV=production; **experiment does not gate** | Supabase Auth |
| Payments | **settlement `/stripe/webhook` has no signature check** (`monetization/src/server.ts:158`). It only refuses livemode, so forged test-mode "paid" sessions mint coins | stripe-webhook verifies signatures |
| Paid-API abuse | **unauthenticated live functions spend credits:** axessplayer-ltx/runway/seedance-video, axessplayer-stitch (Rendi) | 1 of 63 functions rate limited |
| Backups | docs only | daily physical (Supabase) |

## 8. Drift summary (live system vs repo / docs)

1. 22 production edge functions, including all `axessplayer-*`, are not in any repo.
2. 180 live migrations vs 165 repo files. Versions are re-stamped, ~22 axessplayer migrations are not in the repo by
   version, and the `axess_v2` schema has no migration at all.
3. 11 live `verify_jwt=false` functions vs 5 in `config.toml`.
4. Storage policies granting **anon write** to `videos/axessplayer/**` and `thumbnails/works/**` were applied live.
5. Live R2 functions expect `CLOUDFLARE_R2_PUBLIC_URL` / `CLOUDFLARE_R2_AXESSPLAYER_BUCKET`, which are not set
   (hardcoded fallbacks are in use). 3 secrets referenced by mvp functions are missing.
6. Hosting reality vs docs:
   - axessplayer.com is the Lovable app, not the marketing app.
   - The web app is on humanaxess.com.
   - app./studio.axessplayer.com don't exist.
   - VERCEL_DEPLOYMENT.md says the web app is Next.js, but `vercel.json` says vite.
7. Backend: `render.yaml` describes 11 services. 14 Render hosts exist and **all are suspended**.
8. The brief said `deploy.yml` deploys Supabase functions on push to main. It does not.
9. The brief said CI fails because of the pnpm duplicate. That is fixed on feat; feat fails on live-dependent tests.
10. The brief said "manifest service serves /manifest/{id}.m3u8". It does, but from fixtures, and it is not on the
    playback path.
11. `docs/LOCAL_DEV_RUNBOOK.md:70` says prod has no series/beat_variants schema, which contradicts the live `mobile`
    schema.
12. SwissBrain/Exoscale references remain in `docs/REMAINING_BUILD_SEQUENCE.md`, `docs/RECONCILED_BUILD_PLAN.md` and
    `docs/NARRATIVE_WORLD_MODEL.md`. **They belong to a different project and must not drive hosting.**
13. Staging Supabase is empty, so there is no staging→prod path.
