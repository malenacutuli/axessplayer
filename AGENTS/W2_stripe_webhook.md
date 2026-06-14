# W2 sub-spec : Stripe webhook to economy /grant

A focused sub-brief under W2 (economy). It covers the Stripe web-payments path only. The native path (App Store and Play IAP via RevenueCat) is a separate ingestor that calls the same `/grant`. Read `AGENTS/W2_economy.md`, `STRIPE_CATALOG.md`, `contracts/api/economy.yaml`, and `contracts/schema/0001_init.sql` first. No em dashes.

**Mission.** Ingest Stripe payment events and grant coins through the server-authoritative economy `/grant`, idempotently, with verified signatures, in test mode.

**Owns (write only here).** `services/economy/stripe-webhook` (handler), `services/economy/stripe-catalog.ts` (price id to coins map).

**Consumes.** `contracts/api/economy.yaml` (`/grant`), `contracts/schema` (read), `STRIPE_CATALOG.md`, the Stripe test secret and webhook signing secret from env.

**Produces.** the `/stripe/webhook` endpoint and the `coins_granted` ledger events.

**Stack.** Stripe SDK with webhook signature verification, the economy `/grant` typed client.

**First tasks (in order).**
1. Build the `/stripe/webhook` endpoint. Verify every event with `stripe.webhooks.constructEvent` using the signing secret. Reject unverified events with 400 and grant nothing.
2. Handle `checkout.session.completed` (coin packs): resolve the purchased price, look up its coin amount from the catalog map (`price.metadata.coin_amount`), read `user_id` from `client_reference_id` or the customer metadata `app_user_id`.
3. Handle `invoice.paid` (VIP renewals): resolve the subscription price, grant `price.metadata.credit_allowance` coins, set `type` to `subscription`.
4. Call `/grant` with `client_txn_id` set to the Stripe event id (`evt_...`). This makes redelivered or duplicated webhooks a no-op, mapping onto `coin_transactions.UNIQUE (user_id, client_txn_id)`.
5. Handle `customer.subscription.deleted` and `...updated` to reflect VIP status (ad-free, premium access) without granting coins.
6. Return 200 only after `/grant` succeeds or is a confirmed idempotent no-op. On `/grant` failure, return non-200 so Stripe retries.
7. Test with the Stripe CLI fixtures against a test key: a pack purchase grants once, a redelivered event grants zero, a renewal grants the allowance.

**Definition of done (must pass in CI).**
- unverified or wrong-signature events grant nothing
- a pack purchase grants exactly the catalog coin amount, once
- a redelivered event is a no-op (idempotency on the event id)
- a VIP renewal grants the allowance and sets VIP status
- coin amounts come only from the catalog map, never from the client or the raw amount paid

**Guardrails.**
- Test mode only. Never run against the live Stripe key. Live requires a connected test or restricted key and human approval per `STRIPE_CATALOG.md`.
- Never grant on an unverified event.
- The server derives coins from the catalog, never from a client value.
- This is part of the ledger surface: security-review subagent plus human sign-off before merge.

Never edit `contracts/`. No em dashes.
