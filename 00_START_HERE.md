# Axessplayer Build Kit : Start Here

This kit is the complete instruction set for building Axessplayer with Claude Code, using multiple agents in parallel. Read the documents in this order, then begin with the contracts.

## Reading order
1. `00_START_HERE.md` (this file)
2. `01_ARCHITECTURE.md` : the system and why it is shaped this way
3. `CLAUDE.md` : the rules every agent obeys (also lives at repo root)
4. `02_CONVENTIONS.md` : code, tests, git, CI
5. `03_ORCHESTRATION.md` : how to run the orchestrator and parallel agents
6. `BUILD_SEQUENCE.md` : what to launch, in what order
7. `04_WALKING_SKELETON.md` : the first integration milestone and its acceptance test
8. `05_SECURITY_AND_COMPLIANCE.md` : the non-negotiable invariants
9. `06_GLOSSARY.md` : shared vocabulary
10. `contracts/` : the frozen interfaces. Build starts here.
11. `AGENTS/` : one brief per workstream. Paste a brief to start an agent.

## The one rule that makes this work
Freeze the contracts first (Wave 0), then fan out. Do not let any implementation agent start before `contracts/` is frozen and CI is green. Everything else depends on it.

## How to begin (concrete)
1. Create an empty git repo. Copy this kit content into it (the root files, `contracts/`, `AGENTS/`).
2. Open a Claude Code session. Paste `AGENTS/W0_orchestrator.md` as the opening prompt. This scaffolds the monorepo, applies the schema, generates typed clients and mocks, and stands up CI.
3. Get a human to review and approve the frozen contracts.
4. For each Wave 1 workstream, create a git worktree and open a Claude Code session, pasting that workstream's brief. They build in parallel.
5. Drive to the walking skeleton (see `04_WALKING_SKELETON.md`).

Writing rule everywhere, including code comments and user-facing copy: no em dashes. Use periods, colons, or commas.

## Context documents (background, not build instructions)
The strategy behind this kit lives in `Axessplayer_Build_Plan_v2_Agent_Native.md` and `Axessplayer_SOTA_Differentiation_Gap_Analysis.md`. Read them for the why. This kit is the how.
