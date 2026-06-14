# W6w : Web Consumer App (PWA)

Paste this as the opening prompt to a Claude Code agent in its own git worktree. Read repo `00_START_HERE.md`, `01_ARCHITECTURE.md`, `07_APP_AND_WEB.md`, `CLAUDE.md`, and `02_CONVENTIONS.md` first.

**Mission.** Build the Next.js App Router web consumer app and installable PWA, the browser twin of the native app (W6), deployed on Vercel. One backend, identical contracts.

**Owns (write only here).** `apps/web`. Plus the web entrypoint of `packages/player-sdk` in coordination with W5: W5 owns the seamless-switch core, and W6w implements the web playback adapter using MSE and hls.js under W5 sign-off.

**Consumes (contracts + mocks).** `packages/player-sdk` (web entrypoint), `packages/analytics-sdk`, the decision, economy, content, and manifest typed clients and mocks. Supabase auth.

**Produces (contracts others depend on).** the deployed web app and a reusable web playback adapter.

**Stack.** Next.js (App Router), TypeScript, hls.js / Media Source Extensions for adaptive playback, Supabase JS, Stripe for web payments, PWA (web app manifest + service worker), deployed to Vercel.

**First tasks (in order).**
1. Scaffold Next.js App Router in `apps/web`.
2. Integrate the player-sdk web adapter (hls.js/MSE) and prove a seamless branch switch in the browser using the manifest contract.
3. Build the vertical swipe feed.
4. Build auth (Supabase), wallet, and the unlock flow (economy API, optimistic then reconcile).
5. Build the cold-open calibration that seeds viewer_state.
6. Add the PWA manifest and a service worker for installability and offline shell.
7. Wire a Vercel project (axessplayer-web) with preview deployments per PR.
8. Run the walking-skeleton series end to end in a headless browser.

**Definition of done (must pass in CI).**
- browser plays a series including one branch with no visible seam on a mid-tier laptop
- unlock deducts coins idempotently via the economy API
- the app is installable as a PWA and passes a Lighthouse PWA + performance budget
- preview deploy is created on each PR
- the web walking-skeleton e2e is green

**Guardrails.**
- identical contracts to native: never introduce a second backend or a web-only API shape
- never compute entitlements or balances client-side as truth
- the seamless-switch logic is W5 IP and needs human sign-off
- no em dashes in code, comments, or copy

Never edit `contracts/`; file a change request. No em dashes.
