# Environment variable schema

Owned by W11 (infra). This is the single, consolidated catalog of every environment variable the
Axessplayer monorepo reads, by NAME, with a description and the consuming surface. It is a SCHEMA, not a
secret store: it never contains a value. Real values live only in the deployment platform (Vercel project
settings, the container orchestrator's secret store, or a vault), never in any tracked file.

Conventions:
- `VITE_*` are inlined into the web/studio static bundle at BUILD time. They are public by definition;
  never put a secret behind a `VITE_` name. Build one bundle per environment.
- Server-only variables (service-role keys, webhook secrets, the database URL) are read at RUNTIME by the
  service process and must never reach a browser bundle.
- A variable marked `secret` must come from the platform secret store. A variable marked `public` may be
  shipped to clients.
- See `infra/SUPABASE_MIGRATION_RUNBOOK.md` for how the database is provisioned and
  `PRODUCTION_CUTOVER_CHECKLIST.md` for the human cutover order.

## Database / Supabase (server, runtime)

| Name | Class | Consumed by | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | secret | economy, content, trust, generation, decision; e2e + ledger CI | Postgres connection string for the Supabase Postgres (the system of record). The ledger uses it for multi-connection `FOR UPDATE` contention. Format `postgres://USER:PASSWORD@HOST:PORT/DB`. |
| `SUPABASE_URL` | public | services that call Supabase REST/RPC | Base URL of the Supabase project, for example `https://PROJECT.supabase.co`. |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | economy (`/grant`, `/spend` run as service_role), trust, content | Supabase service-role JWT. Grants the privileged role that may execute `spend_coins` and `grant_coins` (migration 0003/0004 restrict these to service_role). Server-only. NEVER expose to a client. |
| `SUPABASE_ANON_KEY` | public | server-side anon-context reads | Supabase anon (public) key. Public by design, RLS still applies. |

## Auth / JWT verification (server, runtime)

The economy, decision, and content HTTP adapters verify a session token (and, for server-to-server calls,
a service token). Production wiring replaces the test verifiers with real JWKS verification.

| Name | Class | Consumed by | Description |
| --- | --- | --- | --- |
| `AUTH_JWKS_URL` | public | economy, decision, content verifiers | URL of the auth provider's JWKS endpoint used to fetch signing keys for session/service JWT verification. |
| `AUTH_JWT_ISSUER` | public | same | Expected `iss` claim. A token whose issuer does not match is rejected. |
| `AUTH_JWT_AUDIENCE` | public | same | Expected `aud` claim. A token whose audience does not match is rejected. |

## KV / Redis (server, runtime)

Consumed by `@axessplayer/kv` (`createKVStoreFromEnv`). Absent => the in-memory default. Present => the
Redis adapter. The decision serving cache can adopt this later.

| Name | Class | Consumed by | Description |
| --- | --- | --- | --- |
| `KV_URL` | secret | `@axessplayer/kv` | Connection URL for the Redis/KV serving cache, for example `rediss://HOST:PORT`. Selects the Redis adapter when set. |
| `REDIS_URL` | secret | `@axessplayer/kv` | Alias for `KV_URL`. Used only if `KV_URL` is unset. |

## CDN / delivery (server, runtime)

| Name | Class | Consumed by | Description |
| --- | --- | --- | --- |
| `CDN_ORIGIN` | public | manifest (playback URL stitching) | Origin/base URL the manifest service prefixes onto segment paths when composing the playlist. Replaces the fixture `playback_urls` at cutover. |
| `DRM_LICENSE_URL` | secret | manifest / player wiring | License server endpoint for DRM-protected renditions. Queued cutover item. |

## Stripe / payments (server, runtime)

W2 owns the webhook handler; W11 owns the keys and endpoint config. The catalog maps Stripe events onto the
economy `/grant` RPC, idempotent on the Stripe `evt_` id.

| Name | Class | Consumed by | Description |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | secret | economy webhook / checkout (server) | Stripe secret API key. Use a TEST or restricted-test key until launch; the live account is shared with other businesses (see `STRIPE_CATALOG.md`). |
| `STRIPE_WEBHOOK_SECRET` | secret | economy webhook handler | Signing secret used to verify the Stripe webhook signature. Never grant coins on an unverified event. |
| `STRIPE_PUBLISHABLE_KEY` | public | web Checkout client | Stripe publishable key for Stripe Checkout on the web client. Public by design. |

## Web app (`apps/web`, BUILD-time, inlined by Vite)

All public. Default to a single localhost gateway when absent (`apps/web/src/config.ts`).

| Name | Class | Description |
| --- | --- | --- |
| `VITE_CONTENT_BASE_URL` | public | Base URL of the content service for this environment. |
| `VITE_ECONOMY_BASE_URL` | public | Base URL of the economy service. |
| `VITE_DECISION_BASE_URL` | public | Base URL of the decision service. |
| `VITE_MANIFEST_BASE_URL` | public | Base URL of the manifest service. |
| `VITE_SUPABASE_URL` | public | Supabase project URL for the browser client. |
| `VITE_SUPABASE_ANON_KEY` | public | Supabase anon key for the browser client. |
| `VITE_SESSION_TOKEN` | public | Demo/static session token used by the walking-skeleton build. Replace with a real auth flow before production. |

## Studio app (`apps/studio`, BUILD-time, inlined by Vite)

| Name | Class | Description |
| --- | --- | --- |
| `VITE_CONTENT_BASE_URL` | public | Base URL of the content service the studio reads the series graph from. |
| `VITE_SUPABASE_URL` | public | Supabase project URL for the studio browser client. |
| `VITE_SUPABASE_ANON_KEY` | public | Supabase anon key for the studio browser client. |

## Mobile app (`apps/mobile`, EAS build profiles, not Vercel)

Set per EAS build profile in `eas.json` and EAS project settings (see `DEPLOY_RUNBOOK.md` section B). The
native build inlines these at build time.

| Name | Class | Description |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | public | Supabase project URL for the device client. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | public | Supabase anon key for the device client. |
| `EXPO_PUBLIC_API_BASE_URL` | public | Base URL of the API gateway the mobile app calls. |

## Service runtime knobs (server)

| Name | Class | Consumed by | Description |
| --- | --- | --- | --- |
| `PORT` | public | manifest (and the documented `serve` entrypoint each service must add) | TCP port the HTTP listener binds. Manifest defaults to 8787; the service Dockerfiles default `PORT` to 8080. |
| `NODE_ENV` | public | all node services | `production` in deployed images. |
| `GENERATION_ALLOW_REAL_SPEND` | public | generation pipeline | Guard flag. When unset/false the generation pipeline does not perform real spends. Keep false outside a deliberate, reviewed run. |

## Notes on Next.js names

`VERCEL_DEPLOYMENT.md` references `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The
actual `apps/web` and `apps/studio` are Vite, not Next.js, so the live code reads the `VITE_*` names above.
If a Next.js surface is added later, mirror the Supabase pair under the `NEXT_PUBLIC_` prefix.

## Session verification (2026-10-01)

Every service that checks a viewer or creator session verifies the Supabase access token with Supabase Auth
(`packages/session-auth`). It needs `SUPABASE_URL` and `SUPABASE_ANON_KEY` (public values). Without them a
deployed service authenticates nobody (signed-in routes answer 401; guest routes keep working).

Local stacks that use the unsigned `session:<uuid>` test tokens must opt in explicitly with
`ALLOW_TEST_SESSIONS=1` (never set this on a deployed service). Test runners are allowed automatically.
