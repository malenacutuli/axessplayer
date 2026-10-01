# PRODUCTION_GAP.md

What must still be built or deployed to make Axessplayer a production-grade microdrama streaming platform.
Based on `DEPLOYMENT_STATE.md` (verified 2026-10-01). Recommendations only; **the host and the Path A/B pipeline
choice are Malena's decisions.** Nothing here has been executed.

Effort: S = days, M = 1–3 weeks, L = 3+ weeks.

## Prioritized gaps

| # | Gap | Why it blocks production | Recommended fix | Build / buy | Effort | Risk | Depends on |
|---|---|---|---|---|---|---|---|
| **G0** | **Open money and credit endpoints** | Unauthenticated live functions (`axessplayer-ltx/runway/seedance-video`, `axessplayer-stitch`) spend paid credits for anyone holding the public anon key. The settlement webhook mints coins without a Stripe signature. `experiment` accepts forged sessions. Anon can upload to public prod storage. | Require a real user JWT plus an ownership check in every `axessplayer-*` function, or disable them. Add `stripe.webhooks.constructEvent` to settlement. Gate `experiment` like the other services. Drop the anon storage write policies (additive migration that replaces them with owner-scoped ones). Recover all 22 unversioned functions into the repo first | build | S–M | **high**: active financial exposure on live functions | none, do first |
| **G1** | **Real auth** | Services accept unsigned `session:<uuid>`. Web uses `demo-session-token` and studio auth is local. Gated services refuse to start in production, so the backend cannot run in prod at all | Implement a JWKS verifier (jose against Supabase `SUPABASE_JWKS`) in the shared auth module. Wire web, studio and mobile Supabase sessions into the service clients | build | M | high | G0 |
| **G2** | **Production host for backend services and the encode worker** (decision **D1**) | Render was re-activated 2026-10-01 and all 14 respond, but decision/economy run `NODE_ENV=staging` (test verifier) and 8 services have no health route. `render.yaml` uses **Oregon** while the database is in **Zurich**, adding a transatlantic round trip to every query | See D1 below | buy | S to resume, M to re-region | medium | Malena decision; G1 before prod traffic |
| **G3** | **Transcode-to-HLS + delivery** (decision **D2**) | No production transcode or ABR. Raw masters play progressively from rate-limited `*.r2.dev` and public Supabase URLs. No signed playback for paid episodes | See D2 below | buy (B) or build (A) | B: S–M. A: L | medium | D1 (Path A only), G1 (signed tokens) |
| **G4** | **Media security** | All media is public, there's no CSP or security headers, and ACAO is `*` everywhere. Paid episodes can be hot-linked | Signed playback tokens (Stream signed URLs or R2 behind a Worker/HMAC). Allowed-origins list. CSP and security headers in `vercel.json`. Restrict CORS to the app domains. DRM later, if a studio contract requires it | build | M | medium | G3 |
| **G5** | **CI green and a promotion path** | CI on feat is red because the `e2e-matrix` suite calls live Render, and every Vercel git build of feat fails. Production deploys are manual CLI pushes plus Lovable's implicit `main` sync. Staging Supabase is empty | Move `e2e-matrix` out of the default `turbo test` into a post-deploy job. Diagnose the Vercel build error. Fix the shared `VERCEL_PROJECT_ID`. Seed staging (functions, schema via `db pull`). Define a promotion path: PR → preview against staging → manual promote to prod. Merge feat into `main` only after CI is green | build | M | low | D1 |
| **G6** | **Migration discipline** | 180 live migrations vs 165 files with re-stamped versions. ~22 axessplayer migrations aren't in the repo by version, and `axess_v2` has no migration at all. Any new migration risks conflicts | `supabase db pull` into a baseline. Commit the axessplayer migrations by their live version. Additive-only from then on. Enable RLS on `mobile.channels`, `mobile.series_channels` and `axess_v2.*` (additive), even though they aren't API-exposed | build | S–M | medium (prod DB; additive only, Zone 1 untouched) | none |
| **G7** | **Observability and reliability** | No error tracking, metrics or alerting. `packages/observability` is unused. 9 services have no `/healthz`. A suspension went unnoticed | Wire `packages/observability` into every `serve.ts`. Add an error tracker. Add `/healthz` everywhere plus Render `healthCheckPath`. External uptime checks on humanaxess.com, the playback path and key APIs. Encode-queue depth and failure alerts | buy + build | M | low | D1 |
| **G8** | **Secrets and config** | 3 referenced secrets missing. R2 functions run on hardcoded fallbacks (bucket, r2.dev URL). Duplicate keys. A GitLab token committed in a public repo | Set `CLOUDFLARE_R2_PUBLIC_URL` / `CLOUDFLARE_R2_AXESSPLAYER_BUCKET` (or remove the fallbacks). Dedupe Stability/TwelveLabs keys. **Revoke the GitLab token now.** Write a rotation runbook (quarterly plus on staff change). Add secret scanning to CI | build | S | high (GitLab token) | none |
| **G9** | **Scale and cost control** | No per-job or per-day caps on generation or encode, no retry or dead-letter queue, no R2 lifecycle | Job queue (Cloudflare Queues or a pg-backed queue) with concurrency limits, per-user and per-day spend caps on generation functions, dead-letter on failed encodes, R2 lifecycle (expire originals N days after a successful encode, if renditions are the source of truth) | build | M | medium | G3 |
| **G10** | **Backups / DR** | Daily physical backups exist, but PITR isn't confirmed, R2 has no versioning or replication, and there's no restore drill | Enable or confirm PITR on prod. Document RPO/RTO. Do a quarterly restore test into staging. Decide on R2 object retention for masters | buy | S | low | G5 (staging) |
| **G11** | **Mobile player** | `PlayerScreen.tsx` is a placeholder | expo-video / react-native-video with HLS, reusing player-sdk decisions | build | M | low | G3 |
| **G12** | **Docs contamination** | SwissBrain/Exoscale references in 3 docs could drive wrong hosting decisions | Remove them, or mark them "different project" | build | S | low | none |

## Security fix log (2026-10-01) and follow-ups found while fixing

| Item | State |
|---|---|
| 22 unversioned prod edge functions | versioned (`0dc54fc`) |
| `axessplayer-*` caller checks (generation and stitch need the service key; R2 uploads need a user) | committed (`7bbc8a5`), **not deployed** |
| Settlement Stripe webhook signature, fail closed | **live 2026-10-01 15:57**: unsigned probe now gets 503 |
| Real session verification (option a: Supabase `/auth/v1/user`, fail closed, 60s cache) in decision, economy, catalog, library, identity, recap, experiment; reward routes credit the session user | committed (`ff3a36a`), staging gate 5/5 (`ffb3b6d`), **awaiting coordinated release** |
| Web sends the real Supabase session; no demo identity in production bundles | committed (`c490656`), ships with `ff3a36a` |
| Anon storage writes closed (migration 0009); generation uses the service key only | committed (`038d984`), **not applied** |

Follow-ups:
- **`STRIPE_WEBHOOK_SECRET` before real settlement.** Settlement fails closed. Before pointing any Stripe
  endpoint at `/stripe/webhook`, set `STRIPE_WEBHOOK_SECRET` on the Render settlement service, or every real
  purchase is rejected (503).
- **admin-api accepts forged operator tokens** (`operator:<id>:<role>`, test verifier live). Suspend the
  service until real operator auth exists (operator allow-list mapped to Supabase users, role from the
  database, never from the token).
- **Rewarded-ad verification is client-asserted** (the web client sends `verified: true`). With session auth,
  abuse is limited to a user's own daily cap. Real fix: ad-network server-side verification callbacks.
- **`users.auth_id` is not in the repo migrations** but exists in prod; the session mapping depends on it.
  Part of G6 (migration baseline).
- **Guest policy.** Signed-out viewers have no session after the release, so session endpoints (wallet,
  decide, library, recap) answer 401 for them. Anonymous Supabase sign-in is deliberately not used: anonymous
  users get the `authenticated` role, which would widen Zone 1 policies.
- **Studio has no real login**, so the R2 upload locks and the owner-scoped upload policy wait on it.

## Decision D1: production host (blocks G2, G5, G7)

**What exists:** `render.yaml` with 11 Docker services (starter plan, Oregon), 14 Render services (all suspended),
10 Dockerfiles, Vercel for web, studio and admin, and Supabase in Zurich.

**Recommended low-ops default:**
- Web, studio and admin stay on **Vercel**. That's already live.
- Data and edge functions stay on **Supabase prod (Zurich)**.
- Backend services and the encode worker (Path A only) stay on **Render**, but **re-created in an EU region close to
  Zurich**.
- Delivery goes through **Cloudflare** (D2).

This reuses everything already configured. Changing provider would mean re-doing Dockerfile wiring, env vars and
health checks for no clear gain at this stage.

**Malena must confirm:**
1. Why the Render services are suspended (billing or manual), and whether to keep Render.
2. The region. Check Render's current EU regions and prices in the Render dashboard; this audit did not verify them.
   Prices are not quoted here on purpose.
3. Which domains are production for the streaming product. Today: humanaxess.com = web app, axessplayer.com = Lovable
   app, axessible.ai → axessplayer.com.

## Decision D2: Path A (reuse R2 + Cloudflare CDN) vs Path B (Cloudflare Stream)

**What the encode code actually is** (see DEPLOYMENT_STATE §6):
- a dev-only Node server with one rendition, no ABR, TS segments, local disk output and in-memory jobs
- a manifest service that runs on fixtures and is not on the playback path
- a Rendi stitch that drops audio

So the reusable production value is **R2 itself, hls.js playback, and the variant/beat data model**. It is not the
encoder or the manifest.

| | **Path A: reuse-max** (R2 + encode worker + Cloudflare CDN) | **Path B: ops-min** (Cloudflare Stream) |
|---|---|---|
| What we build | Containerized ffmpeg worker with an ABR ladder (e.g. 360/540/720/1080 vertical) and CMAF/HLS output, a queue triggered by R2 upload events, writes back to R2, R2 custom domain plus cache rules, signed tokens via a Worker | Upload via Stream direct-creator-upload or a copy from R2. Store the Stream video UID per variant. Player gets the Stream HLS URL with a signed token |
| Pricing (Cloudflare docs, fetched 2026-10-01) | R2 storage $0.015 / GB-month. Class A $4.50/M, Class B $0.36/M. **Egress free.** Plus encode compute on the D1 host (not priced here) | **$5 per 1,000 minutes stored per month. $1 per 1,000 minutes delivered. Encoding free** |
| Cost per delivered minute (estimate) | ≈ **$0.00001 or less**: about 16 segment/playlist GETs per minute at 4s segments, worst case all uncached Class B. The real cost is the encode compute and the engineering and ops time | **$0.001** (i.e. $1,000 per 1M minutes watched) |
| Signed URLs / tokens | build it (Worker + HMAC or cache-key tokens) | **built in** (`requireSignedURLs`, `/token`, signing keys, allowed origins, geo/IP access rules) |
| DRM | possible later with a packager plus a license vendor (build) | not mentioned in the Stream docs reviewed; treat as unavailable |
| Time to live | L | S–M |
| Fit with adaptive per-beat cuts | full control: can stitch chosen and prefetched variants into one playlist (the 01_ARCHITECTURE design) | each variant is its own Stream video. The player switches sources per beat (as `Player.tsx` already does). Server-side multi-variant playlist stitching is harder |
| Ops burden | encoder fleet, queue, ladders, failures | near zero |

**Verified Cloudflare state (2026-10-01) that affects this choice:**
- R2 holds only 3 objects (about 19 MB); the catalogue media is in Supabase Storage.
- The account has **no zone** for any platform domain, so Path A also needs a domain moved or added to Cloudflare
  before R2 can sit behind a custom domain and the CDN.
- Path B delivers from Cloudflare's own Stream hostnames and needs no zone.
- So the "reuse R2" argument for Path A is weak: almost nothing is in R2 yet, and either path starts with a media
  migration out of Supabase Storage.

**Recommendation: Path B for launch, with Path A kept as the cost-down path at scale.**
- The "reuse" in Path A is mostly R2 plus the player, and Path B keeps both. The parts Path A would rebuild (encoder,
  ABR, signing, CDN config) are exactly what Stream provides out of the box.
- At $1 per 1,000 delivered minutes, Stream stays cheap until viewing volume is large.
- Re-evaluate when monthly delivered minutes make the Stream bill exceed the cost of running an encoder, or if
  server-side beat stitching becomes a product requirement.
- Alternative if Malena prefers to keep control from day one: Path A, but budget it as L, and use an R2 custom domain
  instead of r2.dev immediately in either case.

## Path to production-grade streaming (execute only after approval)

1. **Today, security P0s (G0, G8):**
   - Revoke the GitLab token.
   - Recover the 22 unversioned edge functions into the repo.
   - Lock or disable the unauthenticated credit-spending `axessplayer-*` functions.
   - Remove the anon storage write policies (additive replacement).
   - Add the Stripe signature check to settlement.
   - Gate `experiment`.
2. **Baseline (G6, G12):** `db pull` migration baseline, commit axessplayer migrations, clean the SwissBrain docs.
3. **Gate D1: Malena picks the host and region.** Resume or re-create the backend in the EU.
4. **Auth (G1):** JWKS verifier, and real sessions in web, studio and mobile.
5. **CI and promotion (G5):** split `e2e-matrix` into a post-deploy job, fix the Vercel build, seed staging,
   PR → staging → prod.
6. **Gate D2: Malena picks Path A or B.** Build the pipeline (G3), move playback off r2.dev and public buckets, add
   signed playback (G4).
7. **Observability (G7)** and **cost controls (G9)** before opening to real traffic.
8. **DR (G10):** PITR, restore drill.
9. **Mobile player (G11).**
10. Merge `feat/adaptive-accessibility-publish` into `main`. Then run the `e2e-matrix` acceptance against the live
    stack as the release gate.

Zone 1 (accessibility components, their functions and `public` tables) is untouched by every step above. All schema
changes are additive.
