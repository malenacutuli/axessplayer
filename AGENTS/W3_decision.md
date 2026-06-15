# W3 Decision engine agent brief

**Mission.** Replace the deterministic walking-skeleton stub with the real per-viewer decision engine:
a contextual bandit over the viewer state that selects the next beat variant, served as the `/decide`
endpoint inside the p99 < 50ms budget, with every decision logged for offline training. This is the
moat. No em dashes.

**Branch.** `w3-decision`, off main. Never commit to main; merge by PR with orchestrator sign-off.

**Owns (create/edit only these).**
- `services/decision/src/**` (the policy, the handler, the serving layer, the KV cache adapter)
- `services/decision/test/**`
- `services/decision/package.json`, `tsconfig.json`

**Consumes (read-only).**
- `contracts/api/decision.yaml` (frozen, 0.3.1): the `/decide` request and response shape, including
  `decision_id`, `next_variant_id`, `prefetch_variant_ids`, `is_control`, `policy_version`, and the
  `422 no_successors` error.
- Schema (frozen, migrations 0001 to 0004): `viewer_state`, `decision_log`, `beats`, `beat_variants`,
  `beat_edges`. Read these; do not alter them.
- The existing `services/decision/src/policy.ts` and `decide.ts` from the walking skeleton as the
  starting shape (injected `DecisionDB`, the control-holdout pattern).

**Must not touch.** `contracts/`, `supabase/migrations/`, any other service's files, the economy code.

**Build.**
1. Signal capture: accept the beat-level signals in the request (completion, dwell, replays, skipped,
   choice) and update the per-viewer preference vector in `viewer_state`.
2. Policy: a contextual bandit (start with Thompson sampling or LinUCB over engineered features) that
   chooses the next beat variant to maximize a reward blend (completion, return, monetization) subject
   to canon-safety. Keep it explainable enough to prove lift. Keep the control holdout
   (`assignControl`) so you can measure adaptive lift vs the director's cut.
3. Serving: sub-50ms. Read the viewer vector and hot policy params from a KV cache (Redis or an edge KV
   adapter), NOT from Postgres on the hot path. On timeout or opt-out, return the director's cut.
4. Logging: write each decision to `decision_log` asynchronously (a queue or batched writer), never a
   synchronous insert on the serving path.
5. Cold start: seed new viewers from population cohorts; the interactive cold-open calibrates the
   vector in the first 60 seconds.

**Definition of done.** Typecheck + lint clean; your tests green; FULL `pnpm test` green. The `/decide`
handler matches `decision.yaml` exactly (use the codegen types). A documented latency measurement of
the serving path. A test that demonstrates control-vs-treatment assignment is stable and bounded.

**Tests.** Unit tests for the policy (deterministic given a seed), handler-shape tests against the
contract, a control-share test (bounded, with the observed share printed on failure), and a logged
decision assertion. Use `node:test` + tsx, matching the repo convention.

**Flag, do not fake.** The bandit's online learning loop and the offline training job can be stubbed
behind clear interfaces if the data pipeline is not ready, but say so. Do not claim measured lift
without a logged dataset.
