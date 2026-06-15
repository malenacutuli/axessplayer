# mobile : package instructions

**Owner workstream: W6.** Stack: React Native (Expo).

You may write only inside this package. Consume other packages only through `@axessplayer/contracts` generated types and the published clients (and `@axessplayer/player-sdk`). Never edit `contracts/`. Server-authoritative and idempotent on all mutations. No em dashes.

Scope: native consumer app, ships via EAS to the stores.

## Layout

- `src/api/` : the configurable, bearer-authed fetch client over the codegen types (mirrors player-sdk's `createHttpTransport`). `config.ts` (base urls + injected bearer), `types.ts` (contract aliases), `client.ts` (the client + F1 runtime guard).
- `src/feed/` : the vertical swipe feed data layer. `graph.ts` parses the untyped content graph defensively; `feed.ts` flattens series into episode cards.
- `src/accessibility/` : caption / audio-description / sign / language selection, ON by default where the variant provides them.
- `src/player/` : the adaptive player screen controller over `@axessplayer/player-sdk` (`/decide`, prefetch, seamless switch, no menu) plus the a11y + paywall gating the SDK does not own. `transport.ts` wires the SDK transport with the session bearer.
- `src/wallet/` : balance + entitlements from `/wallet`, the paywall (buy / watch ad / subscribe) reflecting the 402 PaywallOptions, optimistic UI then reconcile against `/spend`.
- `src/screens/` : thin RN presentation (Feed, Player, Paywall, Wallet). Native rendering is integration-time verification; the logic lives in the layers above.

## Trust boundary (F1, economy 0.3.2)

The acting user is ALWAYS the session subject carried by the injected bearer. The app NEVER puts a `user_id` (or any caller-asserted identity) in a request body it composes. `client.ts` enforces this at compile time (codegen) AND at runtime (`assertNoForbiddenKeys`). The `/decide` body's `user_id` is the DECISION contract's own required field (decision.yaml v0.3.1), composed inside player-sdk, not by app code; a contract-change request to align it with economy 0.3.2 is filed in the wave report.

## Tests + native deps

The logic / data / contract layers are tested with the repo runner (`node --test` + `tsx`): feed, accessibility, wallet, the api client (incl. F1), and an integration test that completes the unlock flow against a real in-process HTTP server and asserts no `user_id` is ever sent in an economy body. `react` / `react-native` / `expo` are added at EAS build time, not in CI; `src/native/react-shims.d.ts` lets the screens typecheck without the native toolchain. Real device playback and true seamless switching depend on W5 on hardware and are integration-time verification, not claimed here.

Read the matching brief in AGENTS/ and the root CLAUDE.md before coding. Build against mocks until your dependencies are real.
