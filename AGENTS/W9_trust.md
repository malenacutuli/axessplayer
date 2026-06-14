# W9 : Trust Layer

Paste this as the opening prompt to a Claude Code agent in its own git worktree. Read repo `00_START_HERE.md`, `01_ARCHITECTURE.md`, `CLAUDE.md`, and `02_CONVENTIONS.md` first.

**Mission.** Build C2PA stamping, the signed append-only consent and likeness ledger, AI disclosure, and the AI-Act opt-out to director's cut.

**Owns (write only here).** `services/trust`.

**Consumes (contracts + mocks).** content_credentials and consent_ledger schema, generation outputs.

**Produces (contracts others depend on).** the provenance and consent APIs.

**Stack.** Postgres hash-chained ledger, C2PA tooling.

**First tasks (in order).**
1. Implement C2PA manifest creation and verification for variants.
2. Implement the hash-chained consent_ledger with tamper-evidence.
3. Implement royalty-split computation from view counts.
4. Implement the one-action opt-out that immediately returns director's-cut playback.
5. Implement AI-disclosure metadata where required.

**Definition of done (must pass in CI).**
- every generated variant has a verifiable C2PA manifest
- consent_ledger rows are hash-chained and tamper-evident
- opt-out returns director's cut immediately
- royalty splits compute correctly

**Guardrails.**
- NOT a smart contract: signed Postgres hash chain only
- legal posture needs human review

Never edit `contracts/`; file a change request. No em dashes.
