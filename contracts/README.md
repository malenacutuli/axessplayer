# contracts : the frozen interfaces

This directory is the single source of truth for every interface in the system. It is owned by the orchestrator (W0). No other agent edits it.

## Contents
- `schema/0001_init.sql` : the database schema. Content graph, economy, adaptive state, trust.
- `api/decision.yaml` : the sub-50ms decision endpoint.
- `api/manifest.yaml` : seamless branching manifest.
- `api/economy.yaml` : wallet, spend, grant, paywall.
- `api/content.yaml` : content graph read and write.
- `events/events.md` : beat-level signal, ledger, and decision events.

## Freeze and change protocol
1. W0 produces these and generates typed clients and mock servers from them.
2. Once human-approved, they are frozen. Implementation agents build against the generated types and mocks.
3. To change a contract, file a contract-change request to the orchestrator. The orchestrator edits the spec, regenerates clients and mocks, bumps the version, and notifies affected workstreams.

Versioning: each spec is versioned independently by semver. Bump a spec's `version` field only when that spec changes; do not bump unchanged siblings just to match. The version of the contract SET as a whole is the git tag (for example `contracts-v0.3.1`). This supersedes PF-12's uniform-file-version expectation, which forced every spec to one number: that created noise (bumping unchanged files) on every single-spec patch. Breaking changes require notifying every consuming workstream.
