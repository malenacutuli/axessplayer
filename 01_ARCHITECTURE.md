# Architecture

Axessplayer is an adaptive cinema platform: one production that re-cuts itself per viewer, in every language, accessible by default. The system separates into three planes that scale differently. Understand this split before writing code.

## The three planes
1. **Generation (offline).** Every beat variant, language, intensity, ending, and accessibility track is generated and encoded ahead of time and stored as files. A million viewers generate zero new frames. Cost scales with the catalog, not with traffic.
2. **Decision (real-time, cheap).** The only per-viewer real-time work is choosing the next variant: read a small viewer vector from a KV store, evaluate a policy, return an id. Sub-50ms, no video touched. Scales horizontally to millions per second.
3. **Delivery (CDN).** Video is served as HLS or DASH segments cached at the edge, like any streamer. A branch point keeps a few candidate segments warm instead of one.

The two real bottlenecks at scale are CDN egress (managed by cache-hit ratio and capping branch fan-out to the top 2 to 3 candidates) and the coin ledger (every unlock is an ACID write, so it needs sharding, pooling, and idempotency). Design the ledger correctly on day one.

## Component map (monorepo)
```
contracts/    frozen interfaces: schema, API specs, events, generated types  (W0)
services/
  content     content graph CRUD + reuse of Axessible media pipeline         (W1)
  economy     ACID coin ledger, paywall, IAP, rewarded ads                   (W2)
  decision    viewer_state model + policy behind the sub-50ms decide API     (W3)
  manifest    edge stitching: compose variants into one seamless playlist    (W4)
  generation  Tier A/B/C pipeline, continuity + QA gates, C2PA stamping      (W8)
  trust       consent + likeness ledger, provenance, AI-Act opt-out          (W9)
  experiment  holdout framework + adaptive-lift measurement                  (W10)
apps/
  mobile      React Native (Expo) consumer app                               (W6)
  studio      Creator Studio + admin (extends Axessible React/Vite)          (W7)
packages/
  player-sdk     client branching runtime: prefetch + seamless switch        (W5)
  analytics-sdk  beat-level signal capture                                   (W3/W6)
infra/        IaC, CDN config, load tests, observability                     (W11)
```

## Data flow (one beat)
1. Player finishes a beat, emits signals (completion, dwell, skip, choice) via analytics-sdk.
2. Player calls POST /decide with the viewer id, current beat, and signals.
3. Decision service reads the viewer vector from KV, runs the policy, returns the next variant id and a top-k prefetch list, and logs the decision with is_control.
4. Player asks the manifest service to stitch the chosen and prefetched variants into one seamless playlist.
5. CDN serves the segments. The switch at the branch is frame-accurate, no buffer.
6. If the viewer unlocks a premium variant, the economy service performs an idempotent ACID spend.
7. All events flow to the experiment service, which measures lift of treatment vs control.

## Reuse from Axessible
Keep and reuse the timed-text engine, transcription, dubbing (ElevenLabs/Deepgram), resumable upload, R2/S3 storage, and the social-clips generator. The content service wraps these. Do not fork them.
