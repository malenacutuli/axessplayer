# W3 Decision engine: design spec

Companion to `W3_decision.md`. This is the design the W3 agent builds to, because the bandit is the
hardest call in the app and the brief alone is too thin. Confidence is tagged. Open product decisions
are called out so they are made deliberately, not buried in code. No em dashes.

## 0. What this engine is, in one line

A per-viewer model of preference plus a real-time policy that, at each branch point, picks the next
beat variant to maximize a delayed reward (completion, return, monetization) subject to story canon,
inside a sub-50ms budget, with every choice logged so the policy can be trained offline and its lift
proven against a control holdout.

## 1. Viewer state model

- **Storage of record:** `viewer_state` (PK `(user_id, series_id)`), `preference_vector JSONB`,
  `cohort_id`. [Certain] This is the system of record, not the hot path.
- **The vector:** a fixed-length feature vector, explainable first. Suggested initial features:
  rolling completion rate, average dwell, replay rate, skip rate, chosen-intensity EMA, chosen-pace
  EMA, time-of-day bucket, device class, language. Keep it small (tens of features) and named, so you
  can explain a decision and satisfy EU AI Act inspectability.
- **Update:** after each beat, fold the new signals into the vector (exponential moving averages are
  enough to start). Write through to `viewer_state`; keep a hot copy in KV (section 4).
- **Cold start:** seed a new viewer from their cohort's mean vector. The interactive cold-open is the
  calibration that personalizes the vector inside the first 60 seconds.

## 2. The policy (the bandit)

- **Frame:** a contextual bandit. Context = the viewer vector plus beat context (role, branch options,
  canon constraints). Arms = the valid successor variants at this branch (bounded by `beat_edges`).
- **Start explainable [Likely best]:** LinUCB or Thompson sampling over a linear reward model per arm.
  Linear models are debuggable, cheap to serve, and prove the thesis. Evolve to a sequence model (a
  transformer over the viewer's beat history) only once you have logged data and a reason.
- **Exploration:** the UCB/Thompson term gives controlled exploration. Keep an explicit exploration
  rate you can dial down as confidence grows; log it as part of `policy_version`.
- **Arm set is canon-constrained [Certain]:** never consider a variant that is not a valid successor in
  `beat_edges` or that violates `beats.canon_facts`. Canon safety is a hard filter applied before the
  policy ranks anything. A wrong-but-engaging cut that breaks the story is a defect, not a win.

## 3. Reward shaping (a PRODUCT decision, flagged)

Reward is a weighted blend, and the weights are a business choice, not an engineering default:

```
reward = w_c * completion
       + w_r * returned_within_window
       + w_m * monetization_event
       - w_p * canon_or_quality_penalty
```

- [Certain] These signals are **delayed**. Completion is near-term; return and monetization arrive
  minutes to days later. So reward is attributed back to the decision via `decision_id` (the events
  contract already carries it). The policy trains on attributed outcomes, not on the instant of the
  decision.
- **Open decision for you:** the initial weights. A defensible start is completion-weighted with a
  smaller monetization term so the engine optimizes for the experience first and revenue second, then
  rebalance from data. Do not let `w_m` dominate early or the engine learns to paywall-bait.
- Normalize each signal to a comparable scale before weighting, or the largest-magnitude signal silently
  wins.

## 4. Serving (sub-50ms, off the database)

- [Certain] The decision path reads the viewer vector, the candidate variant features, and the hot
  policy parameters from a **KV cache (Redis or edge KV), never Postgres**. Postgres is the system of
  record, refreshed into KV by change-data-capture.
- The decision itself is cheap linear algebra over cached vectors; that is what makes 50ms feasible at
  scale.
- **Hard timeout to the director's cut.** On timeout, opt-out (`users.adaptive_opt_in = false`), or any
  error, return the control/director's cut. This caps tail latency and makes the tier fail safe.
- Serve `decision_id`, `next_variant_id`, `prefetch_variant_ids` (top-k, small), `is_control`,
  `policy_version`, exactly per `decision.yaml`.

## 5. Logging and offline training

- [Certain] `decision_log` is append-only and high volume. Write decisions to a stream (Kafka/Kinesis/
  Pub-Sub) and batch-load, never a synchronous insert on the serving path.
- **Training loop:** a nightly (or streaming) job joins `decision_log` with the attributed outcome
  events, updates the policy parameters, stamps a new `policy_version`, and publishes it to the KV. The
  serving tier picks up the new version without a deploy.
- **Off-policy evaluation before deploy [Certain, important]:** estimate a candidate policy's value from
  logged data with inverse-propensity-scoring or a doubly-robust estimator BEFORE it serves traffic.
  This is why you log the exploration propensity per decision. Shipping an untested policy to a live
  ledger-connected experience is the failure mode to avoid.

## 6. The control holdout and proving lift (the investment thesis)

- [Certain] A fixed fraction of viewers is a permanent **control** that always receives the director's
  cut. Treatment receives the adaptive cut. The metric that matters is the lift in completion, return,
  and monetization of treatment over control. That number is the thesis.
- **The calibration caveat, named:** the walking-skeleton control share came in near 13.3% on the
  fixture ids, not the nominal 10%, because a hash-bucket assignment over a tiny finite id set does not
  land exactly on the boundary. [Certain] On a real population of millions this converges to the
  configured rate, but you must (a) make the holdout percentage a configured value, and (b) monitor the
  realized share in production and alert on drift. Do not trust the nominal number; measure the actual.
- Assignment is a consistent hash of `user_id` so a viewer's arm is stable across sessions (you cannot
  measure lift if people flip arms).

## 7. Phasing (do not build the transformer on day one)

1. **Deterministic stub (done):** the walking-skeleton policy. Keep it as the fallback and the test
   baseline.
2. **Explainable bandit:** LinUCB/Thompson over the named feature vector, KV-served, logged, with the
   control holdout and off-policy eval. This is the W3 deliverable. It proves the thesis.
3. **Sequence model:** only after phase 2 has logged data and a measured ceiling that a richer model
   could plausibly raise. Gated by human design and the same off-policy safety.

## 8. Interfaces it must honor (frozen, do not change)

- `contracts/api/decision.yaml` (0.3.1): request signals, response shape, `422 no_successors`.
- Schema (0001 to 0004): `viewer_state`, `decision_log`, `beats`, `beat_variants`, `beat_edges`. Read
  only; a schema change is an orchestrator decision.
- The events contract: beat-level signals and the `decision_id` attribution key.

If the design needs a field these do not provide (for example a propensity column on `decision_log`),
STOP and raise a contract change to the orchestrator with a version bump. Do not add it in the branch.

## 9. Definition of done and test plan

- Typecheck + lint clean; your tests green; FULL `pnpm test` green.
- The `/decide` handler matches `decision.yaml` exactly (codegen types).
- **Tests:** policy is deterministic given a seed; the arm set is canon-filtered (a test plants an
  invalid edge and asserts it is never chosen); control assignment is stable per user and the realized
  share over a large sample is within tolerance of the configured rate, printing the observed share on
  failure; the handler logs a decision with `policy_version` and the propensity; a timeout path returns
  the director's cut.
- A documented latency measurement of the serving path against the KV (not Postgres).
- **Flag, do not fake:** the offline training job and the streaming logger can be clear interfaces with
  in-memory fakes for the first cut, but say so. Never report measured lift without a real logged
  dataset and an off-policy estimate.

## 10. Open decisions for you (the human, before the agent finalizes)

1. Reward weights (`w_c`, `w_r`, `w_m`, `w_p`) and the return window. Product call.
2. Control holdout percentage, and whether it is per-series or global.
3. The explainability bar (EU AI Act): how much of a decision must be reconstructable from named
   features. This constrains how soon you move to phase 3.
4. Whether `decision_log` needs a `propensity` (and maybe `policy_version`) column for honest off-policy
   evaluation. My read: [Likely] yes, and it is a small additive contract change worth doing before W3
   starts, so the logged data is usable for training from day one rather than backfilled.
