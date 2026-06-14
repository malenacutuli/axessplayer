# economy : package instructions

**Owner workstream: W2.** Stack: Postgres RPC + Stripe/RevenueCat.

You may write only inside this package. Consume other packages only through `@axessplayer/contracts` generated types and the published clients. Never edit `contracts/`. Server-authoritative and idempotent on all mutations. No em dashes.

Scope: ACID coin ledger, paywall, /spend, /grant, Stripe webhook (test mode only).

Read the matching brief in AGENTS/ and the root CLAUDE.md before coding. Build against mocks until your dependencies are real.
