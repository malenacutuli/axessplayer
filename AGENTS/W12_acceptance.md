# W12 End-to-end acceptance agent brief (the integration gate)

**Mission.** Prove adaptive cinema works end to end against the integrated system: one viewer walks the
seed graph and the adaptive loop fires for real. When this is green, the moat is demonstrated, not
asserted. This is the gate the whole build has been pointing at. No em dashes.

**Branch.** `w12-acceptance`, off main. Merge by PR with orchestrator sign-off.

**Owns.** `tests/e2e/**` (or a dedicated `acceptance` package), and the harness that stands up the
services plus a real Postgres and drives the flow.

**Consumes (read-only).**
- All four services through their real interfaces: `/decide` (W3), `/manifest` (W4), `/wallet`,
  `/spend`, `/grant` (W2a economy HTTP), and content graph (W1). Use the codegen client.
- `packages/player-sdk` (W5) for the switch logic.
- `supabase/migrations` (0001 to 0005) and `supabase/seed.sql`, applied to a real Postgres
  (embedded-postgres locally, a `postgres:15` service in CI).

**Must not touch.** Any service's internals, `contracts/`, `supabase/migrations/`. You wire and assert;
you do not modify the things under test.

**The acceptance flow (assert every hop).**
1. Apply migrations 0001 to 0005 and the seed against a fresh real Postgres.
2. Cold open: a viewer starts; `viewer_state` is seeded or written.
3. At the branch beat, `/decide` returns a `decision_id`, a `next_variant_id`, `prefetch_variant_ids`,
   `is_control`, `policy_version`, and logs a `decision_log` row (with `propensity` for treatment).
4. `/manifest/{variant_id}.m3u8` returns a parseable HLS playlist for the chosen and prefetch variants.
5. The player selects and switches to the chosen cut at the branch point (switch logic, not device
   frame-accuracy).
6. A treatment viewer at intensity 5 receives the tense cut; a control viewer receives the director's
   cut (calm). Assert both arms.
7. The premium ending: `/spend` (session-scoped, own-once) unlocks variant `cccccccc-...0005`, deducts
   5, grants the entitlement; a replay and a second-txn buy are no-ops; the entitlement now gates the
   variant.

**Definition of done.** The full flow green against real Postgres, both arms exercised, the premium
unlock and own-once asserted end to end. Runs in CI as an integration job (its own `postgres:15`
service, like the ledger suites). FULL `pnpm test` stays green.

**Tests.** The acceptance scenarios above, deterministic (force the arm in the harness where needed, as
the unit tests do, or seed enough users to land one in each arm). Real Postgres, real services, the
codegen client, the player SDK.

**Flag, do not fake.** Device-level seamless playback (true frame-accuracy on hardware) is W5 plus
on-device verification, out of scope here. This gate proves the decision, manifest, economy, and content
wiring plus the player's switch decision, which is the integration claim that matters first.
