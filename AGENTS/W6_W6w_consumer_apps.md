# W6 Mobile + W6w Web consumer apps agent brief

**Mission.** The user-facing surface: a vertical swipe feed, the adaptive player screen, and the wallet
plus paywall flow, for the React Native (Expo) mobile app and the web app. Build against the typed
client and mock servers now; swap to live services during integration. No em dashes.

**Branch.** `w6-mobile` and `w6w-web`, off main. Merge by PR with orchestrator sign-off. (If mobile and web
diverge enough, split into `w6-mobile` and `w6w-web`; keep shared UI in `packages/ui`.)

**Owns.** `apps/mobile/**`, `apps/web/**`, and shared components in `packages/ui/**`.

**Consumes (read-only).**
- The codegen client over all four API specs (decision, economy, manifest, content), frozen.
- `packages/player-sdk` (W5) for playback and the seamless switch.
- Mock servers (Prism over the specs) and the seed fixtures until the real services are live.

**Must not touch.** `contracts/`, the services' code, `supabase/`.

**Build.**
1. Vertical swipe feed of series/episodes (content graph via the client).
2. The adaptive player screen using the player SDK: it calls `/decide`, plays the chosen cut, prefetches
   candidates, and switches seamlessly. The adaptation is invisible, there is no menu.
3. Wallet and paywall: show balance and entitlements from `/wallet`; at a premium beat, present the
   paywall (buy, watch ad, subscribe) and call `/spend`; reflect the 402 PaywallOptions. Never send a
   `user_id` in any request body (the session carries identity, per the 0.3.2 contract).
4. Accessibility first: captions, audio description, sign, and language are selectable and on by
   default where the variant provides them.

**Definition of done.** Typecheck + lint clean; component/integration tests green; FULL `pnpm test`
green. The app runs end to end against the Prism mocks: browse, play an adaptive episode, hit the
paywall, unlock the premium ending. Accessible by default.

**Tests.** Component tests for the feed, player screen, and paywall; an integration test against the
mocks that completes the unlock flow and asserts no `user_id` is ever sent in a body. Use the repo's
test runner.

**Flag, do not fake.** Real device playback and true seamless switching depend on W5 on real hardware;
test the UI flows and the contract calls here, and mark device-level playback as integration-time
verification.
