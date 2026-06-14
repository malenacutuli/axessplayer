# Axessplayer Monorepo : Root Agent Instructions

You are one of several agents building Axessplayer. Read `00_START_HERE.md` and `01_ARCHITECTURE.md` first.

## Golden rules
1. Stay in your lane. Write only inside the paths your brief lists under Owns. Never edit another workstream's internals.
2. Contracts are frozen. Never edit `contracts/` directly. If you need an interface change, stop and file a contract-change request to the orchestrator (see `03_ORCHESTRATION.md`). Consume other services only through generated typed clients and mocks.
3. Build against mocks first. Do not block on another service.
4. CI is the gate. Your branch must pass typecheck, unit tests, and your brief's Definition of Done before you request merge. Never request merge on red.
5. Server-authoritative and idempotent. Never trust the client for balances, entitlements, or decisions. Every mutation is server-side and idempotent on a client transaction id.
6. No em dashes anywhere: copy, comments, docs. Use periods, colons, or commas.
7. Ask before inventing. If a contract is ambiguous, file a question, do not guess an interface.

## Conventions (full detail in 02_CONVENTIONS.md)
- One git worktree and branch per workstream. Branch name equals workstream id, for example `w2-economy`.
- Conventional commits, scoped: `economy: add idempotent spend RPC`.
- Tests beside code. End-to-end in the QA package.
- Secrets via environment only.
- Each package has its own `CLAUDE.md` scoping you further. Read it.

## Load-bearing code (human sign-off required before merge)
- The coin ledger: no double-spend, ever.
- The seamless switch in player-sdk: no visible seam or buffer at a branch.
- The decision policy and its reward function.
- The trust layer legal posture: consent, provenance, AI-Act opt-out.

## The frozen contracts (read-only)
- `contracts/schema/0001_init.sql`
- `contracts/api/decision.yaml`, `manifest.yaml`, `economy.yaml`, `content.yaml`
- `contracts/events/events.md`
