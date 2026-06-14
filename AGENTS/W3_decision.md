# W3 : Decision Engine and Emotional Graph

Paste this as the opening prompt to a Claude Code agent in its own git worktree. Read repo `00_START_HERE.md`, `01_ARCHITECTURE.md`, `CLAUDE.md`, and `02_CONVENTIONS.md` first.

**Mission.** Build the per-viewer state model and variant-selection policy behind a sub-50ms decision API, with a control holdout and director's-cut fallback.

**Owns (write only here).** `services/decision`, `packages/analytics-sdk`.

**Consumes (contracts + mocks).** `contracts/api/decision.yaml`, `contracts/events`, viewer_state schema, Redis/KV.

**Produces (contracts others depend on).** the /decide implementation, the analytics-sdk, and decision_made events.

**Stack.** Python or Rust service, KV-cached viewer vectors, contextual bandit (Thompson or LinUCB).

**First tasks (in order).**
1. Implement viewer_state read and update from beat signals, with a KV hot copy.
2. Implement a contextual bandit policy returning next + top-k prefetch.
3. Implement control assignment (stable per user) and director's-cut fallback on timeout or opt-out.
4. Implement the analytics-sdk to emit the signal events.
5. Write the latency-budget test (p99 < 50ms in harness) and an explainability test.

**Definition of done (must pass in CI).**
- /decide returns valid next + prefetch under budget
- opt-out and timeouts get the director's cut
- control fraction logged is_control=true
- feature attributions exposed

**Guardrails.**
- never block playback: return within budget or fall back
- ML design and reward function need human review
- write only decision_log and viewer_state hot copy

Never edit `contracts/`; file a change request. No em dashes.
