# W7 : Creator Studio and Admin

Paste this as the opening prompt to a Claude Code agent in its own git worktree. Read repo `00_START_HERE.md`, `01_ARCHITECTURE.md`, `CLAUDE.md`, and `02_CONVENTIONS.md` first.

**Mission.** Extend the Axessible React/Vite dashboard into the Content Factory: upload beats, trigger dubbing and accessibility, map the adaptive graph.

**Owns (write only here).** `apps/studio`.

**Consumes (contracts + mocks).** content API, Axessible dashboard components.

**Produces (contracts others depend on).** the studio app and admin tools.

**Stack.** React + Vite (existing Axessible), Supabase.

**First tasks (in order).**
1. Refactor the existing video dashboard into a series and beat manager.
2. Build a visual editor to attach variants and draw beat_edges.
3. Add one-click dubbing and accessibility generation per beat.
4. Build an analytics view reading decision_log and economy aggregates.

**Definition of done (must pass in CI).**
- a director uploads beats, attaches variants, draws edges
- one-click dubbing works
- analytics view renders

**Guardrails.**
- reuse existing Axessible components, do not rewrite
- write only via the content API

Never edit `contracts/`; file a change request. No em dashes.
