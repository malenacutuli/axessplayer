# W10 : Experimentation and Adaptive Lift

Paste this as the opening prompt to a Claude Code agent in its own git worktree. Read repo `00_START_HERE.md`, `01_ARCHITECTURE.md`, `CLAUDE.md`, and `02_CONVENTIONS.md` first.

**Mission.** Build the holdout framework and causal lift measurement that proves adaptation beats a fixed cut.

**Owns (write only here).** `services/experiment`.

**Consumes (contracts + mocks).** `contracts/events`, decision_log, economy aggregates.

**Produces (contracts others depend on).** lift dashboards and a stable control-vs-treatment assignment service.

**Stack.** Warehouse (BigQuery or ClickHouse), dbt, a stats layer.

**First tasks (in order).**
1. Implement stable per-user control assignment, logged and consistent with decision_log.
2. Ingest the event stream into the warehouse.
3. Build the lift dashboard: completion, day-7 and day-30 retention, ARPU, treatment vs control, with confidence intervals.
4. Build an uplift model identifying who benefits most from adaptation.

**Definition of done (must pass in CI).**
- control assignment is stable and logged
- dashboard reports lift with confidence intervals
- uplift model runs

**Guardrails.**
- read-only on other services, never mutate content or economy
- keep it rigorous, this is the investor proof

Never edit `contracts/`; file a change request. No em dashes.
