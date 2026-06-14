# W6 : Consumer Mobile App

Paste this as the opening prompt to a Claude Code agent in its own git worktree. Read repo `00_START_HERE.md`, `01_ARCHITECTURE.md`, `CLAUDE.md`, and `02_CONVENTIONS.md` first.

**Mission.** Build the Expo app: vertical swipe feed, player integration, wallet and rewards UI, cold-open calibration, character chat.

**Owns (write only here).** `apps/mobile`.

**Consumes (contracts + mocks).** player-sdk, economy API, decision API, content API (mocks first).

**Produces (contracts others depend on).** the consumer app.

**Stack.** React Native (Expo), Supabase auth, RevenueCat.

**First tasks (in order).**
1. Build auth and the vertical swipe feed playing beats via player-sdk.
2. Build the unlock flow calling economy with optimistic UI then reconcile.
3. Build the cold-open calibration that seeds viewer_state.
4. Build wallet, rewards, and check-in UI.
5. Wire the walking-skeleton series end-to-end against mocks, then real services in Wave 2.

**Definition of done (must pass in CI).**
- swipe feed plays beats and switches at a branch
- unlock deducts coins and reconciles
- cold open seeds state
- e2e watches a series including one branch

**Guardrails.**
- never compute entitlements or balances locally as truth
- build against mocks until Wave 2

Never edit `contracts/`; file a change request. No em dashes.
