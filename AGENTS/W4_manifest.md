# W4 : Edge Manifest Stitching

Paste this as the opening prompt to a Claude Code agent in its own git worktree. Read repo `00_START_HERE.md`, `01_ARCHITECTURE.md`, `CLAUDE.md`, and `02_CONVENTIONS.md` first.

**Mission.** Compose candidate beat variants into one seamless HLS/DASH playlist at the edge.

**Owns (write only here).** `services/manifest`.

**Consumes (contracts + mocks).** `contracts/api/manifest.yaml`, content read API, decision prefetch list.

**Produces (contracts others depend on).** the stitched manifest endpoint.

**Stack.** Cloudflare Worker or Supabase edge function, HLS/DASH manipulation.

**First tasks (in order).**
1. Implement GET manifest that stitches the chosen variant plus prefetch into one playlist.
2. Define and document the segment-boundary contract with W5.
3. Implement director's-cut fallback playlist on any error.
4. Write a test that a branch produces a continuous playlist with no gap marker.
5. Add a compose-latency budget test.

**Definition of done (must pass in CI).**
- branch point yields a continuous playlist, no gap
- compose stays within budget
- error falls back to director's cut

**Guardrails.**
- do not transcode here, only manipulate manifests
- coordinate segment boundaries with W5

Never edit `contracts/`; file a change request. No em dashes.
