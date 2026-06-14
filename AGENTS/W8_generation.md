# W8 : Generation and AI Factory

Paste this as the opening prompt to a Claude Code agent in its own git worktree. Read repo `00_START_HERE.md`, `01_ARCHITECTURE.md`, `CLAUDE.md`, and `02_CONVENTIONS.md` first.

**Mission.** Orchestrate Tier A/B/C generation with continuity and canon-safety checks, accessibility tracks, and C2PA stamping on render.

**Owns (write only here).** `services/generation`.

**Consumes (contracts + mocks).** content API, model vendors behind an abstraction, story bible.

**Produces (contracts others depend on).** QA-passed variants and provenance records via the content and trust APIs.

**Stack.** Python orchestration, swappable video and voice model adapters.

**First tasks (in order).**
1. Define the model-adapter abstraction (video, voice) with one concrete adapter each.
2. Implement Tier B generation from a consented likeness and Tier C localization.
3. Implement automated continuity and canon-safety checks gating qa_status.
4. Stamp every generated asset with a C2PA manifest before it is playable.
5. Generate accessibility tracks (audio description, sign) as variants.

**Definition of done (must pass in CI).**
- generate a Tier B variant and a Tier C localization
- continuity and safety checks gate qa_status
- every asset gets a C2PA manifest

**Guardrails.**
- model layer behind an abstraction, no vendor lock
- consented likeness only, no third-party face-swap
- human QA gate before a variant is playable

Never edit `contracts/`; file a change request. No em dashes.
