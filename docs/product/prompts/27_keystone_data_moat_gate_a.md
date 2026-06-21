# Prompt 27: Keystone, make the data moat real and report one Adaptive Lift number

**Run this next, before more surface UI. June 21 2026. No em dashes.**

Source of truth: docs/product/BUILD_STATE_AND_CONTINUE.md (section 2). This prompt is the build directive for it.
Ground every claim against the live mobile schema (project faeyekynudyzeotbjfsj), do not assume.

## Context you must accept first
The decision schema is correct but operationally hollow: 70 synthetic decisions, propensity on only 32, viewer_state
has 0 rows, only 24 decisions have a joined outcome, 2 users. The platform can generate video; the data moat has
never run against real viewers and cannot currently produce a clean lift number. Your job is to fix that. Do not add
new surface features in this prompt.

## Hard constraints
- STAY ON SUPABASE POSTGRES. Do NOT introduce Kafka, Kinesis, Neo4j, Snowflake, BigQuery, ClickHouse, Redis, or
  Vowpal Wabbit. The REELM spec section 7 lists these; ignore that section. An in-process bandit plus Postgres is
  correct at this scale. If you believe you need new infrastructure, STOP and file the question, do not adopt it.
- Do not edit frozen contracts, supabase/migrations canonical files, or ledger RPCs without founder sign-off.
- Reward-weight changes need founder sign-off. Do not self-sign.
- No em dashes anywhere.

## Tasks (in order, each with a definition of done)

### T1. Propensity on 100 percent of decisions
The decision service must write `propensity` (P(policy chose the served arm | context)) on every decision row.
Audit why 38 of 70 are null and fix forward. Add a test that fails if any new decision is persisted with null
propensity. DoD: a fresh synthetic run shows 0 null-propensity rows, and the regression test is green.

### T2. Viewer Genome feature builder
Populate viewer_state from engagement_events. Per viewer: EWMA features per narrative attribute (romance_affinity,
conflict_tolerance, pacing_preference, caption_reliance, completion_propensity, unlock_propensity, ad_tolerance,
brand_receptivity, churn_risk), an archetype_cluster for cold start, consent flags, and a maturity counter
(n_sessions, n_beats_seen). Write to viewer_state.preference_vector for hot serving. DoD: after a synthetic session
run, viewer_state has one row per active viewer with non-empty features, and the decision service reads them into
its context vector.

### T3. Outcome Joiner for delayed outcomes
A batch or stream job attaches delayed outcomes (D1 and D7 return, downstream unlock and revenue) to each
decision_id, producing the full matched triple. Start single-objective: continuation or D7 return. DoD: the share of
decisions with a joined outcome rises from 24/70 toward full coverage for matured decisions, and a query can return
(context_snapshot, chosen_arm, propensity, is_control, reward) for any decision.

### T4. Experiment harness reports Adaptive Lift
Hold a fixed, logged randomized control slice. Compute Adaptive Lift = (adapted minus control) / control on D7
return or continuation, with a confidence interval. Expose it on the experiment service and the admin console. DoD:
the harness returns a real number with a CI from logged data.

### T5. Gate A run on a real series
Point a small slice of real traffic at one series (the animated test series is acceptable) and one lever (start with
pacing or romance_intensity), control held out. DoD: one real, statistically described Adaptive Lift figure on one
series and one lever, even if small and noisy, reported via T4, plus a one-paragraph readout: lever, N, lift, CI,
and whether propensity coverage and control sizing were clean enough to trust it.

### T6. Off-policy evaluation, once propensity is clean
After T1, enable nightly IPS and Doubly-Robust estimates on logged data so candidate policies can be evaluated
before promotion. DoD: a nightly job emits IPS and DR estimates for the current policy versus the logged control.

## Out of scope for this prompt (defer, do not start)
Uplift / CATE / Qini reporting (REELM Phase 3), multi-objective reward blending (Phase 4), and any new surface UI.
These are polish on top of a number you do not yet have. Resume the section-4 surface sequence in
BUILD_STATE_AND_CONTINUE.md only after T5 reports a real number.

## Report back
A short readout: propensity coverage before and after, viewer_state row count after the genome builder, outcome-join
coverage, the Adaptive Lift number with its CI, confirmation that nothing new was added to the stack, and the
resolution of the cost-gate-bypass check (every real clip routed through the cost-gated generation service and
appears in generation_attempts).
