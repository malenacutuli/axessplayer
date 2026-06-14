# Orchestration Playbook

## Roles
- Orchestrator agent (plus a human tech lead). Owns `contracts/` and root `CLAUDE.md`. The only agent allowed to change contracts. Runs integration.
- Implementation agents (W1..W11). One per workstream, each in its own git worktree and branch, writing only within owned paths.
- QA agent (W12). Owns end-to-end tests and the walking skeleton.
- Review subagents. A security-review subagent gates ledger, auth, and provenance. A test-writer subagent backfills coverage. Run these as Claude Code subagents to keep focused context.

## Wave sequence (see BUILD_SEQUENCE.md)
- Wave 0 (serial): run W0. Freeze schema, API, events, types, mocks, CI. Human sign-off. Nothing else first.
- Wave 1 (parallel): launch W1, W2, W3, W4, W7, W8, W9, W10, W11. W5 starts the runtime spike.
- Walking skeleton: W12 plus slices of W1 to W6 wire one series end-to-end with a control holdout. Top priority.
- Wave 2: W6 on real services, W5 hardening, W10 lift live, W8 scaling, W2 load-hardening.
- Wave 3: scale, placement, studio, compliance, launch.

## Running agents in Claude Code
- Create a worktree per workstream: `git worktree add ../w2-economy w2-economy`.
- Open one Claude Code session per worktree. Paste that workstream's brief from `AGENTS/` as the opening prompt.
- Keep root `CLAUDE.md`, the package `CLAUDE.md`, and the relevant contract files in context.
- Use subagents for review and test passes so they do not consume the implementation agent's context.
- Merge green branches into `main` daily. The QA agent re-runs e2e on `main`.

## Contract-change protocol
1. An agent opens a contract-change request: the field or endpoint needed and why.
2. The orchestrator updates the spec in `contracts/`, regenerates typed clients and mocks, and bumps the version.
3. The orchestrator notifies affected workstreams. Agents pull the new types and adapt.
No agent edits `contracts/` directly. Ever.

## What stays human-led
Agents implement and test against human-authored specs for the four load-bearing areas: the ledger (W2), the seamless switch (W5), the decision policy (W3), and the trust legal posture (W9). Humans design and sign off on these. Do not delegate their design.
