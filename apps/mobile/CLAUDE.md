# mobile : package instructions

**Owner workstream: W6 / P8.** Stack: Expo SDK 57 (React Native 0.86, React 19), expo-router, expo-video, Supabase Auth. TypeScript 6 (the version Expo SDK 57 pins).

You may write only inside this package. Never edit `contracts/`. Server-authoritative and idempotent on all mutations. No em dashes.

Scope: native consumer app (iOS + Android), ships via EAS to the stores. Platform v2: free, accessible-by-default creator video. Guests can watch everything; sign-in only unlocks tipping and the library.

## Run

```
pnpm install                                 # from the repo root
pnpm gen                                     # contract types used by the legacy v1 modules (typecheck)
cp apps/mobile/.env.example apps/mobile/.env.local   # fill EXPO_PUBLIC_SUPABASE_ANON_KEY locally
pnpm --filter @axessplayer/mobile start      # expo start; press i / a, or scan with a dev build
EXPO_PUBLIC_USE_MOCKS=1 pnpm --filter @axessplayer/mobile start   # in-memory content + public HLS test streams
pnpm --filter @axessplayer/mobile test       # node:test over src/**/*.test.ts
pnpm --filter @axessplayer/mobile typecheck
pnpm --filter @axessplayer/mobile export:web # metro web bundle smoke test
pnpm --filter @axessplayer/mobile doctor     # npx expo-doctor
```

expo-video needs a development build (`npx expo run:ios` / `run:android` or EAS) for full native playback; Expo Go works for most of it.

## Layout

- `app/` : expo-router routes. `(tabs)/index.tsx` Home (Netflix-like rows), `(tabs)/shorts.tsx` Shorts (TikTok-like pager), `(tabs)/account.tsx` sign-in + settings, `watch/[id].tsx` Watch. `_layout.tsx` mounts the providers and the first-launch consent prompt.
- `src/core/` : pure TypeScript, no React Native imports, unit tested with node:test.
  - `config/env.ts` EXPO_PUBLIC_* resolution and defaults.
  - `api/` typed content client (`/feed/shorts`, `/feed/home`, `/videos/:id`, `/videos/:id/playback`), defensive parsers, mocks. `http.ts` attaches `Authorization: Bearer <supabase access token>` only when signed in and turns every failure (404 included) into an `ApiResult` instead of throwing.
  - `feed/shorts.ts` paging (cursor, dedupe) and the playback window (one active, next preloaded, previous mounted, rest released).
  - `player/` quartile tracker, letterbox math, signed playback url cache and retry policy.
  - `a11y/tracks.ts` caption track selection (captions ON by default), badges, sponsor disclosure, duration labels.
  - `consent/` analytics consent gate (default OFF). `analytics/events.ts` POST /events, gated at send time. Default wire is the collector AxpEvent shape (`{ eventId, sessionId, name, ts, props }`, taxonomy names such as completion_25 / caption_toggled); `wire: "flat"` posts the brief ViewEvent shape.
  - `economy/tips.ts` POST /tips (signed in only, Idempotency-Key header, 404 means coming soon).
- `src/state/` : React providers (Auth via Supabase + AsyncStorage, Prefs for consent and captions, Services for the clients).
- `src/ui/` : components and the `useVideoPlayback` hook (expo-video) shared by Shorts and Watch.
- Legacy v1 (series graph, /decide, wallet + paywall): `src/api`, `src/feed`, `src/accessibility`, `src/player`, `src/wallet`, `src/integration`, exported from `src/index.ts`. Not used by the v2 app, kept with their tests.

## Rules

- Never put a user id in a request body; the acting user is the bearer subject (F1). Guests send no Authorization header.
- Analytics events go out only after explicit consent. Captions default ON. Sponsored videos always show the "Sponsored by <brand>" card.
- Every control has an accessibility label and a 48 dp target; respect reduce motion and font scaling.
- `EXPO_PUBLIC_*` values are public and inlined at build time. Never put a secret in them. The anon key is read from env only.
- Real device playback, captions rendering from Stream manifests and background audio are verified on hardware, not in CI.
