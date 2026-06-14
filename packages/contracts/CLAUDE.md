# contracts-client : package instructions

**Owner workstream: W0.** Stack: TypeScript codegen.

You may write only inside this package. Consume other packages only through `@axessplayer/contracts` generated types and the published clients. Never edit `contracts/`. Server-authoritative and idempotent on all mutations. No em dashes.

Scope: generated OpenAPI clients + hand-maintained event types. Only W0 edits.

Read the matching brief in AGENTS/ and the root CLAUDE.md before coding. Build against mocks until your dependencies are real.
