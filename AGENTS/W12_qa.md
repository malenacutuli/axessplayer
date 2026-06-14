# W12 : QA, Integration and Walking Skeleton

Paste this as the opening prompt to a Claude Code agent in its own git worktree. Read repo `00_START_HERE.md`, `01_ARCHITECTURE.md`, `CLAUDE.md`, and `02_CONVENTIONS.md` first.

**Mission.** Own end-to-end tests and drive the walking-skeleton milestone on a real or emulated device.

**Owns (write only here).** the e2e package and integration scripts.

**Consumes (contracts + mocks).** all services and apps (read), mocks.

**Produces (contracts others depend on).** the green e2e suite that gates integration.

**Stack.** Playwright or Detox, seeded fixtures.

**First tasks (in order).**
1. Author the walking-skeleton acceptance test per 04_WALKING_SKELETON.md.
2. Seed fixtures: one series, three beats, a branch at beat 2, one premium variant.
3. Wire the slices of W1 to W6 needed to pass the test.
4. Run e2e on main daily; file failures to the owning workstream.

**Definition of done (must pass in CI).**
- the walking skeleton passes end to end, including idempotency and control-group checks
- e2e green on main daily

**Guardrails.**
- file failures as issues, do not fix other workstreams' internals
- protect the walking skeleton as top priority

Never edit `contracts/`; file a change request. No em dashes.
