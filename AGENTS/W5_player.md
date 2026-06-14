# W5 : Player SDK (branching runtime)

Paste this as the opening prompt to a Claude Code agent in its own git worktree. Read repo `00_START_HERE.md`, `01_ARCHITECTURE.md`, `CLAUDE.md`, and `02_CONVENTIONS.md` first.

**Mission.** Build the client runtime that prefetches the top-k next variants and switches at a branch with no visible seam or buffer.

**Owns (write only here).** `packages/player-sdk`.

**Consumes (contracts + mocks).** `contracts/api/manifest.yaml`, decision prefetch list, low-latency player primitives.

**Produces (contracts others depend on).** the player SDK consumed by apps/mobile.

**Stack.** React Native, ExoPlayer/AVPlayer or Mux/FastPix SDK, dual-decoder or pre-stitched switching.

**First tasks (in order).**
1. Build a vertical player wrapper over the chosen low-latency primitive.
2. Implement top-k prefetch driven by the decision prefetch list.
3. Implement frame-accurate switching at a branch (dual-decoder or pre-stitched).
4. Implement graceful fallback to a single fixed cut on low bandwidth.
5. Emit the signal events; test the seamless switch on a mid-tier device.

**Definition of done (must pass in CI).**
- frame-accurate switch with no buffer on a mid-tier device
- graceful low-bandwidth fallback
- emits signal events

**Guardrails.**
- hardest IP: human-authored design + human sign-off required
- never let a decision delay block playback

Never edit `contracts/`; file a change request. No em dashes.
