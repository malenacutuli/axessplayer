# W0 : Contracts and Monorepo (orchestrator)

Paste this as the opening prompt to a Claude Code agent in its own git worktree. Read repo `00_START_HERE.md`, `01_ARCHITECTURE.md`, `CLAUDE.md`, and `02_CONVENTIONS.md` first.

**Mission.** Scaffold the monorepo, clear the pre-freeze checklist, freeze the contracts, generate typed clients and mocks, and stand up CI. Nothing else starts until this is green and human-approved.

**Owns (write only here).** the repo scaffold, `contracts/`, root `CLAUDE.md`, CI config.

**Consumes.** the strategy docs, `contracts/schema/0001_init.sql`, and `contracts/PRE_FREEZE_CHECKLIST.md`.

**Produces.** frozen `contracts/`, generated `contracts/types`, mock clients and mock servers, CI pipeline.

**Stack.** pnpm + turborepo, Supabase migrations, OpenAPI codegen, TypeScript, GitHub Actions.

**First tasks (in order).**
1. Initialize the pnpm + turborepo monorepo with the package layout from 01_ARCHITECTURE.md.
2. Apply contracts/schema/0001_init.sql as the first Supabase migration; verify it applies to a fresh database. (Note: the file is 0001_init.sql, not schema.sql.)
3. Work through contracts/PRE_FREEZE_CHECKLIST.md. Confirm PF-1..PF-5 are reflected in 0001_init.sql and the API specs. Get a human decision on PF-6 (the manifest and prefetch contract) and apply it.
4. Generate TypeScript types from the schema and OpenAPI specs into contracts/types.
5. Generate mock clients and mock servers for decision, manifest, economy, content.
6. Stand up CI: typecheck, lint, unit, contract validation on the empty scaffold.
7. Write a per-package CLAUDE.md stub scoping each workstream to its owned paths.
8. Request human sign-off, then declare contracts frozen and bump versions to 0.2.0.

**Definition of done (must pass in CI).**
- migrations apply cleanly to a fresh Supabase, including the RLS enable block
- the pre-freeze checklist is fully resolved (PF-6 confirmed with a human)
- typed clients, mocks, and mock servers generate and import in every package
- CI is green on the empty scaffold

**Guardrails.**
- you are the ONLY agent that may change contracts
- implement scaffolding and contracts only, no business logic
- get human sign-off before freezing; do not freeze with PF-6 open

Never edit `contracts/` after freezing; route changes through the contract-change protocol. No em dashes.
