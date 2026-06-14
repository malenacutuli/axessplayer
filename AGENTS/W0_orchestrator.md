# W0 : Contracts and Monorepo (orchestrator)

Paste this as the opening prompt to a Claude Code agent in its own git worktree. Read repo `00_START_HERE.md`, `01_ARCHITECTURE.md`, `CLAUDE.md`, and `02_CONVENTIONS.md` first.

**Mission.** Scaffold the monorepo, clear the pre-freeze checklist, freeze the contracts, generate typed clients and mocks, and stand up CI. Nothing else starts until this is green and human-approved.

**Owns (write only here).** the repo scaffold, `contracts/`, root `CLAUDE.md`, CI config.

**Consumes.** the strategy docs, `contracts/schema/0001_init.sql`, `contracts/events/events.md`, and `contracts/PRE_FREEZE_CHECKLIST.md`.

**Produces.** frozen `contracts/`, generated `contracts/types` (including event types), mock clients and mock servers, CI pipeline.

**Stack.** pnpm + turborepo, Supabase migrations, OpenAPI codegen, TypeScript, GitHub Actions.

**First tasks (in order).**
1. Initialize the pnpm + turborepo monorepo with the package layout from 01_ARCHITECTURE.md and 07_APP_AND_WEB.md (apps/mobile, apps/web, apps/studio, apps/marketing).
2. Apply contracts/schema/0001_init.sql as the first Supabase migration; verify it applies to a fresh database. (The file is 0001_init.sql, not schema.sql.)
3. Work through contracts/PRE_FREEZE_CHECKLIST.md. Confirm the resolved items are reflected in the files. Get human sign-off on the three open items: PF-6 (manifest/prefetch, W5), PF-8 (M2 series_id integrity), PF-10 (M4 manifest session_id). Apply the confirmed decisions.
4. Generate TypeScript types from the schema and the OpenAPI specs (decision, manifest, economy, content) into contracts/types.
5. Generate event types from contracts/events/events.md so analytics-sdk, decision, and experiment share a typed event contract.
6. Generate mock clients and mock servers for decision, manifest, economy, content.
7. Stand up CI: typecheck, lint, unit, contract validation on the empty scaffold.
8. Write a per-package CLAUDE.md stub scoping each workstream to its owned paths.
9. Request human sign-off, then declare contracts frozen and tag contracts-v0.3.0.

**Definition of done (must pass in CI).**
- migrations apply cleanly to a fresh Supabase, including the RLS enable block
- the pre-freeze checklist is fully resolved (PF-6, PF-8, PF-10 confirmed with humans)
- typed clients (including the economy client) and event types generate and import in every package
- mock clients and mock servers generate
- CI is green on the empty scaffold

**Guardrails.**
- you are the ONLY agent that may change contracts
- implement scaffolding and contracts only, no business logic
- get human sign-off before freezing; do not freeze with PF-6, PF-8, or PF-10 open

Never edit `contracts/` after freezing; route changes through the contract-change protocol. No em dashes.
