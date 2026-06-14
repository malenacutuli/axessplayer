# W11 : Infra, Scale and Observability

Paste this as the opening prompt to a Claude Code agent in its own git worktree. Read repo `00_START_HERE.md`, `01_ARCHITECTURE.md`, `CLAUDE.md`, and `02_CONVENTIONS.md` first.

**Mission.** Own IaC, CDN cache strategy, KV, autoscaling edge, load testing, metrics, and tracing.

**Owns (write only here).** `infra/`.

**Consumes (contracts + mocks).** all service deploy targets.

**Produces (contracts others depend on).** the deploy pipeline, dashboards, and load-test suite.

**Stack.** Terraform or Pulumi, Cloudflare, Redis/KV, k6 or Locust, OpenTelemetry.

**First tasks (in order).**
1. Stand up IaC for services, KV, and CDN with cache rules.
2. Implement branch fan-out caps and popular-path pre-warming.
3. Build the load-test suite to the target concurrency.
4. Wire tracing app to decision to manifest to CDN, and the core dashboards.
5. Add cost alerts on egress and origin-miss spikes.

**Definition of done (must pass in CI).**
- load test sustains target concurrency with cache-hit and ledger-latency budgets met
- branch fan-out capped and pre-warm works
- traces span the full path

**Guardrails.**
- do not change service code, provide config and harness only
- enforce cost guardrails

Never edit `contracts/`; file a change request. No em dashes.
