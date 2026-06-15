# Axessplayer: parallel-agent orchestration plan

**Version 1.0 · June 2026 · Axessible Technologies**

How to build the rest of the app with parallel Claude Code agents, one per workstream, against the
frozen contracts. This is the orchestrator's map: current state, what can run in parallel now, the
rules every agent follows, and how the pieces integrate. Writing rule: no em dashes anywhere.

## 1. Current state of main

Done and merged:
- W0 scaffold: pnpm + turborepo monorepo, CI (build + ledger jobs), codegen wiring, lockfile.
- Contracts, FROZEN: schema migrations 0001 to 0004, API specs (decision, economy, manifest, content)
  at 0.3.x, events. Per-spec semver, the git tag is the set version (contracts-v0.3.2).
- W2 economy service: three hardened RPCs (spend_coins, grant_coins, schema CHECKs) and the
  /wallet, /spend, /grant handlers. F1/F2/F3 hardened, concurrency-proven against real Postgres.

Stub or empty (the work ahead):
- W1 generation pipeline, W3 decision engine (deterministic stub only), W4 manifest service,
  W5 player runtime, W6 content service, W7 trust/provenance, the consumer apps (mobile/web/studio),
  and the economy HTTP adapter.

## 2. Why this parallelizes: contracts are frozen

Every service workstream can build at the same time because the interfaces between them are frozen.
An agent integrates with the rest of the system ONLY through three frozen surfaces, never by reaching
into another workstream's code:

1. The generated TypeScript client (openapi-typescript over the API specs). You call other services
   through the typed client, never by importing their internals.
2. The database schema (migrations 0001 to 0004). You read and write only the tables your workstream
   owns. You never alter the schema.
3. The event contract (events.md). You emit and consume events by name and shape.

If a workstream discovers it needs a contract change (a new field, a new endpoint, a schema column),
it STOPS and raises it to the orchestrator. Contracts do not change inside a feature branch. This is
the rule that keeps parallel work from colliding.

## 3. Parallelization waves

**Wave A: launch now, fully independent.** No dependency on each other, only on the frozen contracts.

Workstream numbers follow the existing merged kit taxonomy (W1 content, W2 economy, W3 decision,
W4 manifest, W5 player, W6 mobile, W6w web, W7 studio, W8 generation, W9 trust).

| Workstream | Owns | Consumes |
|---|---|---|
| W8 Generation | the offline variant pipeline | schema (beats, beat_variants, content_credentials) |
| W3 Decision | /decide service + the bandit policy | decision.yaml, schema (viewer_state, decision_log, beats, beat_variants) |
| W4 Manifest | /manifest service | manifest.yaml, schema (beat_variants) |
| W1 Content | /content CRUD service | content.yaml, schema (series, episodes, beats, beat_variants, beat_edges) |
| W9 Trust | provenance + consent | schema (content_credentials, consent_ledger) |
| W2a Economy HTTP | the adapter over the existing handlers | economy.yaml, the merged handlers |

**Wave B: start now against mocks, integrate when Wave A is live.**

| Workstream | Owns | Consumes |
|---|---|---|
| W5 Player runtime | seamless branching client | decision.yaml + manifest.yaml (via mock servers first) |
| W6 Mobile + W6w Web | feed/player/paywall UI (shared scope in the consumer-apps brief) | the typed client + mock data |

**Wave C: integration.** Studio app (authoring over W6), experiment/analytics (over decision_log +
events), and the W12 end-to-end acceptance test.

## 4. Rules every agent follows (non-negotiable)

1. **Branch per workstream** (`w3-decision`, `w4-manifest`, ...). Never commit to main. Merge by PR
   with the orchestrator's sign-off.
2. **Contracts, schema, and ledger code are orchestrator-owned.** If your work needs a change there,
   STOP and propose it. Do not edit `contracts/`, `supabase/migrations/`, or the economy RPCs.
3. **Own only your paths** (each brief lists them). Do not edit another workstream's files. Resolve
   cross-workstream needs through the orchestrator, not by reaching across.
4. **Tests are real and verified, not asserted.** Run the FULL `pnpm test` before claiming green, not
   only your package. (This is a hard-won lesson: a behavior change once broke a third test suite that
   was not in front of the agent.) Money and ledger paths get real-Postgres tests, not just PGlite.
5. **No em dashes anywhere**, in code, comments, or docs.
6. **Definition of done** for every workstream: typecheck clean, lint clean, your tests green, the
   FULL turbo suite green, plus a short notes doc stating what was verified and what was deferred.
7. **Flag, do not fake.** If a dependency is not ready, build against a mock and say so. Never stub a
   guarantee (idempotency, auth, ACID) and call it done.

## 5. Integration strategy

- Each service publishes its OpenAPI; consumers use the codegen client, so a service can change its
  internals freely as long as the contract holds.
- **Mock servers** (Prism over the OpenAPI specs, `prism mock contracts/api/<spec>.yaml`) let the
  player and app workstreams build and test before the real services are live.
- The **W12 walking-skeleton acceptance** is the integration gate: seed, then /decide returns a
  variant, /manifest returns its playlist, the player switches at the branch point, /spend unlocks the
  premium ending, the entitlement gates it. When that passes end to end, the slice is real.

## 6. Merge order

Wave A branches merge independently as each goes green (they do not touch each other). Then the player
and apps swap their mock servers for the live services and integrate. Then W12 acceptance runs against
the integrated system. The economy HTTP adapter (W2a) should merge early, since it unblocks any
workstream that needs to call the economy for real rather than through a mock.

## 7. What the orchestrator owns (me, with your sign-off)

Contracts and every change to them (version bump plus sign-off), the schema and migrations, all ledger
code, the per-workstream merge gates, cross-workstream conflict resolution, and the final integration
acceptance. Each agent builds inside its lane; the orchestrator owns the lanes and the seams.

## 8. How to launch

For each Wave A workstream, start a Claude Code agent with its brief (the `AGENTS/` files alongside
this plan) as the opening instruction, on a fresh branch off main. The briefs are self-contained: each
states the mission, the paths it owns, the contracts it consumes, the definition of done, and the
boundaries it must not cross. Run Wave A in parallel; bring me each branch for review and sign-off when
its definition of done is met.
