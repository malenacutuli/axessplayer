# App and Web : consumer surfaces

## Principle

There is one backend. The frozen contracts at v0.3.0 (Postgres schema, the decision, manifest, economy, and content OpenAPI specs, and the events schema) are the single source of truth. Every client talks to that backend over those contracts.

The web app is a second client, not a second backend. Native and web call the identical decision, economy, content, and manifest APIs. They send the identical events. The platform does not gain a parallel API surface, a web-only data store, or a forked schema because a browser client exists. If a behavior is not expressible through the frozen contracts, it does not ship until the contracts say it does.

## Front-end surfaces and owners

Four front-end surfaces, each owned by a workstream.

### apps/mobile (W6)

Native app, React Native plus Expo, iOS and Android. This is the primary consumer experience: the vertical adaptive feed, seamless branch switching, wallet, unlocks, and character chat as a first-class product. Ships through EAS to the App Store and Google Play.

### apps/web (W6w, NEW)

The browser twin of the consumer app. Next.js App Router, installable as a PWA. Same vertical adaptive feed, same session model, same wallet and entitlements. The public `/watch` demo lives here, so this surface is also the front door for unauthenticated and first-touch viewers. Deploys to Vercel.

### apps/studio (W7)

Creator Studio and admin. React plus Vite. Extends the existing Axessible dashboard rather than starting a new shell. Used by creators and operators, not consumers. Deploys to Vercel.

### apps/marketing (NEW)

axessplayer.com: home, enterprise, and about pages. Next.js or static export, whichever keeps the build cheapest for mostly static content. No consumer playback logic. Deploys to Vercel.

## Code sharing strategy

The goal is one backend and as much shared client code as possible. Sharing happens in packages, not by copying screens between apps.

`packages/player-sdk` and `packages/analytics-sdk` are platform-agnostic. The branching and prefetch decision logic is shared: native and web compute the next segment the same way, against the same decision and manifest responses. Divergence is pushed down to the lowest possible layer.

The playback primitive differs by platform. Native uses a low-latency player SDK (ExoPlayer on Android, AVPlayer on iOS, surfaced through Mux or FastPix). Web uses MSE with `hls.js`. To contain this, `packages/player-sdk` exposes a native entrypoint and a web entrypoint behind one interface. Callers depend on the interface, not on ExoPlayer or `hls.js` directly. The seamless-switch logic (W5 IP) lives above that interface and is shared across both clients. The buffering layer that the switch logic drives is platform-specific and lives behind the entrypoint.

Business logic stays shared. Wallet, entitlements display, cold-open calibration, and session signals live in shared packages consumed by both clients. A change to how an unlock is displayed, or how a session signal is shaped, is made once.

## Monorepo layout

```
apps/
  mobile/        # W6  React Native + Expo, iOS + Android, EAS to App Store + Play
  web/           # W6w Next.js App Router, installable PWA, /watch demo, Vercel
  studio/        # W7  React + Vite, Creator Studio + admin, Vercel
  marketing/     # NEW Next.js or static export, axessplayer.com, Vercel

packages/
  player-sdk/    # platform-agnostic decision + prefetch + seamless-switch
    src/
      index.ts        # shared interface + switch logic (W5 IP)
      native.ts       # native entrypoint  (ExoPlayer / AVPlayer via Mux / FastPix)
      web.ts          # web entrypoint     (MSE + hls.js)
  analytics-sdk/ # platform-agnostic event emission against the events schema
  ui/            # shared primitives where feasible (tokens, low-level components)
```

## Parity table

| Feature | Native (apps/mobile) | Web (apps/web) |
| --- | --- | --- |
| Vertical adaptive feed | Full | Full |
| Seamless branch switch | Full, native buffering | Full, MSE + hls.js buffering |
| Cold-open calibration | Full | Full |
| Wallet + unlock | Full | Full |
| Rewarded ads | Full (native ad SDK) | Weaker: browser rewarded video is limited, fewer fill sources |
| Character chat | Full | Full |
| Offline | Full (downloaded segments) | Limited: PWA cache only, no full offline library |
| Install | App Store / Google Play | PWA install prompt (add to home screen) |

Payments differ by surface: in-app purchase runs through App Store and Google Play on native, and through Stripe on web. Both settle against the same economy contract; only the purchase rail differs.

## Contracts note

The manifest, decision, economy, and content contracts are identical across native and web. Both clients read the same manifest responses, request the same decisions, settle against the same economy endpoints, and resolve the same content. Adding the web client does not change any frozen contract.
