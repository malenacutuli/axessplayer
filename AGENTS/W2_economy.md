# W2 : Coin Economy and Ledger

Paste this as the opening prompt to a Claude Code agent in its own git worktree. Read repo `00_START_HERE.md`, `01_ARCHITECTURE.md`, `CLAUDE.md`, and `02_CONVENTIONS.md` first.

**Mission.** Build the ACID coin ledger, paywall, IAP, and rewarded-ad grants, correct under high concurrency.

**Owns (write only here).** `services/economy`.

**Consumes (contracts + mocks).** `contracts/types`, `contracts/schema` (read), `contracts/api/economy.yaml`, RevenueCat and AppLovin sandboxes.

**Produces (contracts others depend on).** the economy API and ledger events.

**Stack.** Postgres RPC with row-level locking, idempotency keys, pgBouncer.

**First tasks (in order).**
1. Implement the spend_coins RPC exactly per the schema contract: row-locked, idempotent, atomic.
2. Implement /spend, /grant, /wallet per economy.yaml; emit ledger events.
3. Implement the paywall response (buy, watch ad, subscribe) on 402.
4. Wire RevenueCat IAP and AppLovin rewarded-ad grants with idempotent reconciliation.
5. Write the concurrency suite: thousands of simultaneous spends on one wallet.

**Definition of done (must pass in CI).**
- concurrency suite proves no double-spend and no lost grant
- spends idempotent on client_txn_id
- IAP and rewarded-ad reconciliation tests pass

**Guardrails.**
- never trust the client for balance
- every mutation is a server-side idempotent RPC, never raw UPDATE
- request security-review subagent + human sign-off before merge

Never edit `contracts/`; file a change request. No em dashes.
