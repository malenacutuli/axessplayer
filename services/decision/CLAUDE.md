# decision : package instructions

**Owner workstream: W3.** Stack: Python or Rust + KV.

You may write only inside this package. Consume other packages only through `@axessplayer/contracts` generated types and the published clients. Never edit `contracts/`. Server-authoritative and idempotent on all mutations. No em dashes.

Scope: viewer_state, sub-50ms /decide, contextual bandit, control holdout, analytics-sdk.

Read the matching brief in AGENTS/ and the root CLAUDE.md before coding. Build against mocks until your dependencies are real.
