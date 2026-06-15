# W5 Player runtime agent brief

**Mission.** The seamless branching runtime: a player that pre-buffers the candidate next beats the
decision engine returns and switches between them frame-accurately, with no stall or seam, so the
per-viewer re-cut is invisible. This is the hard playback IP. No em dashes.

**Branch.** `w5-player`, off main. Merge by PR with orchestrator sign-off.

**Owns.** `packages/player-sdk/src/**`, `packages/player-sdk/test/**`, and that package's manifest.

**Consumes (read-only).**
- `contracts/api/decision.yaml`: calls `/decide`, reads `next_variant_id` and `prefetch_variant_ids`.
- `contracts/api/manifest.yaml`: fetches `/manifest/{variant_id}.m3u8` for the chosen and prefetch
  variants.
- The codegen client for both. Build against MOCK servers (Prism over the two specs) until W3 and W4
  are live, then integrate.

**Must not touch.** `contracts/`, the services' code, `supabase/`.

**Build.**
1. Predictive prefetch: ask `/decide` at a beat boundary, then fetch and buffer the top-k
   `prefetch_variant_ids` manifests ahead of the decision point. Keep top-k small (2 to 3) to bound
   egress.
2. Frame-accurate seamless switch at the branch point, using multiple decoders or pre-stitched
   candidate segments so there is no gap.
3. Adaptive bitrate and a graceful fallback to the default cut on low bandwidth (degrade to a great
   fixed film, never to a spinner).
4. Target React Native (Expo) for the consumer app plus a web target, over a low-latency player base
   (ExoPlayer/AVPlayer/Media Source Extensions), with the branching logic on top.
5. Emit beat-level signals (completion, dwell, replays, skipped, choice) back to `/decide`.

**Definition of done.** Typecheck + lint clean; tests green; FULL `pnpm test` green. A demo harness that,
against the mock servers, walks the seed graph cold-open to branch to ending and logs the switch points
with zero reported gap.

**Tests.** Unit tests for the prefetch and switch logic with a fake transport; an integration test
against Prism mocks of decision + manifest that exercises one full branch. `node:test` + tsx.

**Flag, do not fake.** True frame-accuracy needs a real media stack and devices; if you can only prove
the buffering and switch-decision logic in the test environment, say exactly that and mark the
device-level seamlessness as the remaining verification.
