# What we learn from Eko's open source, built on newer tech

**Version 1.0 - June 2026 - Axessible Technologies.** Canonical engineering north star. Eko (EkoLabs) is
the closest prior incumbent in interactive branching video and open-sourced the plumbing. We take the API
shapes, leave the 2018-2022 runtimes, and rebuild on today's primitives (native MSE, managed HLS/LL-HLS,
edge KV, modern Expo/React Native). No em dashes.

## The four repos that earn their keep

| Eko repo | The real lesson | Axessplayer layer |
|---|---|---|
| eko-js-sdk | Embeddable-player public API: `load`, `invoke`, an event bus | player-sdk public API + web embed |
| iframily | Safe cross-iframe comms (promise RPC, queue-until-paired, explicit origin) | PlayerBridge for Studio preview + external embeds |
| react-native-background-downloader | Background prefetch of large files + re-attach after app kill | mobile offline + beat-variant prefetch + per-user render delivery |
| sonorous | WebAudio: autoplay-unlock gesture, concurrent-sound pooling, fades | player audio (AD track, dialogue, SFX) |

The rest (eko-react-sdk, react-animation-orchestration, a-frame/gallery/wordpress/site/stock/build glue)
are thin wrappers or framework-specific and not load-bearing for our player/decision/economy spine.

## 1. Player public API (eko-js-sdk shape, modern transport)

Keep: `player.load(projectId, { params, events, cover })` as the one entry point; `player.invoke(method,
...args)` with structured-clone-only args (data crosses the boundary, never functions); a typed event bus.
Our events: `beatstart`, `beatend`, `branchresolved`, `prefetchhit`, `paywallshown`. Keep cover/loading
state classes so the host styles the gap before first frame.

Modernize: web player is a first-party React component, NOT a cross-origin iframe. Reserve the iframe path
for the Studio live preview and partner/creator embeds, where isolation is a feature. Media is standard
HLS/LL-HLS over MSE (hls.js on web, native AVPlayer/ExoPlayer on mobile), so seamless branch switching is
prefetch-plus-MSE, not a proprietary container.

Action: define the `player-sdk` public API in this shape, document in `contracts/`, implement web as a
direct component, reserve iframe transport for preview/embed.

## 2. Safe postMessage (iframily discipline, maintained lib)

Keep the discipline (raw postMessage is a footgun): promise-based request/response (no manual correlation
ids); queue-until-paired (buffer messages before handshake, kills the "iframe not ready" race); named,
reconnecting channels (survive a reload/redirect as the player navigates beats); mandatory explicit
`targetOrigin` (never wildcard).

Modernize: iframily is unmaintained; use `penpal` or `post-me` (active, typed) with the same discipline,
behind one thin `PlayerBridge` so the rest of the app never touches postMessage. This is also the
instruction-source boundary: messages from an embed iframe are DATA, never commands that can trigger spends
or grants. Same hard line our economy + consent layers already enforce.

## 3. Background prefetch and offline (Expo resumable, cold-start re-attach)

The one pattern that matters: re-attach after restart. On launch, `checkForExistingDownloads()` reconnects
`begin/progress/done/error` callbacks to downloads the OS kept running while the JS context was dead. Without
it you orphan in-flight downloads and re-download from zero. Plus wifi-only/`network` + `priority` controls,
and per-download callbacks.

Modernize: the Eko repo is archived (Feb 2022). Use `expo-file-system` resumable/background downloads
(`createDownloadResumable`, persisted resume token) or `@kesha-antonov/react-native-background-downloader`.

Three callers, one TTL cache: (a) offline-save a whole series on wifi; (b) seamless-branch prefetch (the
candidate next beats the bandit predicts, high priority, short TTL); (c) the per-user face-swap render
(be-the-protagonist) delivered as a prioritized background download into the per-user cache.

Action: build a `MediaPrefetch` module on Expo resumable downloads with cold-start re-attach, wifi-only +
priority, one TTL cache shared by offline-save, branch-prefetch, and personalized-render delivery.

## 4. Audio (sonorous ideas, managed renditions)

Keep: the autoplay-unlock gesture (browsers block audio until a user gesture; surface an explicit "tap to
start" and only arm the audio graph after); pooled concurrent playback for layered audio (dialogue + the
always-on accessible audio-description track + UI/coin SFX + ambience, mixing and crossfading on a branch
switch); fades + seek as first-class for the seamless crossfade at a beat boundary.

Modernize: do not hand-build a mixer. Model the accessible audio-description track as a first-class HLS
alternate audio rendition; use a managed player for sync + crossfade; keep only a small pooled-SFX layer.
Brand rule holds: gold sound cues only on coin/premium moments.

Action: gate the web audio graph behind an explicit unlock gesture; AD track as an HLS alternate rendition;
small pooled-SFX layer.

## 5. The net: five lifts, one posture

1. Player public API in the eko-js-sdk shape; web direct, iframe for preview/embed.
2. Safe postMessage via penpal/post-me with iframily discipline, behind one `PlayerBridge`.
3. Background prefetch + offline on Expo resumable downloads with cold-start re-attach; one TTL cache.
4. Audio: unlock gesture, AD as HLS alternate rendition, small pooled SFX, crossfade on branch boundaries.
5. Standard media transport (HLS/LL-HLS over MSE + native players); seamless switch = prefetch-plus-MSE.

The posture from Eko across all of it: the boundary between host page and player, and between any embed and
our services, is a hard security line where messages are data and never commands. Eko learned it at the
iframe; we apply it everywhere.

## Status against this doc (2026-06-15)

Landed now: the web player is vertical 9:16 by default and rotates to full-bleed landscape (orientation
hook + rotate control + best-effort fullscreen/orientation lock). Not yet built: the formal `load`/`invoke`
SDK API + event bus, the `PlayerBridge` (penpal) for Studio preview/embeds, the Expo `MediaPrefetch`,
the audio unlock + HLS alternate-rendition AD, and HLS/LL-HLS over MSE (today the player plays direct MP4
or the gradient poster). These are the sequenced player-platform build.

## Sources

eko-js-sdk, iframily, react-native-background-downloader (archived) + @kesha-antonov fork, sonorous,
penpal, expo-file-system (resumable/background downloads).
