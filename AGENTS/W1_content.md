# W1 Content service agent brief

**Mission.** Implement the content graph API: resolve a series into a playable graph, and the authoring
CRUD for series, episodes, beats, variants, and edges. This is the backbone the studio writes to and
the player reads from. No em dashes.

**Branch.** `w1-content`, off main. Merge by PR with orchestrator sign-off.

**Owns.** `services/content/src/**`, `services/content/test/**`, that package's manifest.

**Consumes (read-only on schema, read/write on the content tables it owns at runtime).**
- `contracts/api/content.yaml` (frozen, 0.3.1): `/series/{id}/graph` (read) and the create endpoints
  for series, episodes, beats, variants, edges, including the documented `4xx` shapes and operationIds.
- Schema (frozen): `series`, `episodes`, `beats` (composite FK to episodes), `beat_variants`,
  `beat_edges`. Respect the composite FK (a beat's `series_id` must equal its episode's series).

**Must not touch.** `contracts/`, `supabase/migrations/`, other services.

**Build.**
1. `GET /series/{id}/graph`: assemble episodes, beats, variants, and edges into the playable graph the
   decision engine and player expect. 404 on unknown series.
2. The create endpoints, each validating the composite-FK integrity and the enum fields (role, tier,
   scope). Return the documented 201 and 400 shapes.
3. Server-authoritative defaults (coin_cost, is_free, is_premium) per the schema; never trust a client
   to set a price the catalog does not allow.

**Definition of done.** Typecheck + lint clean; tests green; FULL `pnpm test` green. Graph resolution
matches what the seed produces for the walking-skeleton series. Matches `content.yaml` exactly.

**Tests.** Build the seed series through the create endpoints and assert `GET .../graph` returns the
expected nodes and edges; assert the composite-FK rule rejects a beat whose series does not match its
episode; validation rejects bad enums. Run against PGlite (fast) with the real migrations applied.

**Flag, do not fake.** If you need a content field the schema does not have, STOP and raise a contract
change to the orchestrator; do not add a column in this branch.
