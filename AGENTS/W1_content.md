# W1 : Content Graph Service

Paste this as the opening prompt to a Claude Code agent in its own git worktree. Read repo `00_START_HERE.md`, `01_ARCHITECTURE.md`, `CLAUDE.md`, and `02_CONVENTIONS.md` first.

**Mission.** Build CRUD and graph resolution for series, beats, variants, edges, reusing the Axessible media pipeline.

**Owns (write only here).** `services/content`.

**Consumes (contracts + mocks).** `contracts/types`, `contracts/schema` (read), `contracts/api/content.yaml`, Axessible media edge functions.

**Produces (contracts others depend on).** the content read and write API and a resolved beat-graph endpoint.

**Stack.** Node or Deno edge functions, Supabase, reused Axessible functions.

**First tasks (in order).**
1. Implement create endpoints for series, beats, variants, edges per content.yaml.
2. Implement GET /series/{id}/graph returning a playable beat graph with no orphan edges.
3. Wire reuse: attach transcription and dubbing outputs as language and accessibility variants.
4. Seed one demo series with three beats and a branch at beat 2 (for the walking skeleton).
5. Write unit tests on graph integrity.

**Definition of done (must pass in CI).**
- create a full series graph and resolve it
- reuse transcription and dubbing to attach variants
- graph integrity tests pass (no orphan edges, valid branch points)

**Guardrails.**
- never write to wallet or decision tables
- treat media functions as dependencies, do not fork them

Never edit `contracts/`; file a change request. No em dashes.
