# Stripe Catalog : Axessplayer web payments

Stripe is the web payments provider. Mobile uses App Store and Play IAP via RevenueCat. Both paths grant coins through the same server-authoritative economy `/grant` endpoint. This doc defines the products, prices, and the webhook to `/grant` mapping, plus a runbook to create them. No em dashes.

## Safety note (read first)
The Stripe key connected to this workspace is the LIVE key for the account "Axessible Technologies" (acct_1RvN9wCAKg7jOuBK), which already holds live products for other businesses (SwissMed, SwissVault, Ghost Pro). Do not create the Axessplayer catalog in live mode while it is in pre-launch and the contracts are not even frozen. Create it in TEST mode first. Switch the connector to a test or restricted test key, or run the calls below with a test secret key. Promote to live only when pricing is final and a human approves.

## Products and prices (proposed, adjust before creating)
All amounts USD. Coin packs are one-time. VIP is recurring. Higher packs carry a better coin-per-dollar rate to reward whales, the standard micro-drama pattern.

### Coin packs (one-time)
| Product name | Price (USD) | coin_amount (metadata) | Note |
|---|---|---|---|
| Axessplayer Coins, Starter | 0.99 | 100 | entry |
| Axessplayer Coins, Plus | 4.99 | 550 | 10 percent bonus |
| Axessplayer Coins, Pro | 9.99 | 1200 | 20 percent bonus |
| Axessplayer Coins, Max | 19.99 | 2500 | 25 percent bonus |
| Axessplayer Coins, Mega | 49.99 | 7000 | 40 percent bonus |
| Axessplayer Coins, Whale | 99.99 | 15000 | 50 percent bonus |

### VIP subscription (recurring)
| Product name | Price (USD) | interval | metadata |
|---|---|---|---|
| Axessplayer VIP | 7.99 | week | tier=vip, credit_allowance=400 |
| Axessplayer VIP | 19.99 | month | tier=vip, credit_allowance=1800 |
| Axessplayer VIP | 149.99 | year | tier=vip, credit_allowance=24000 |

VIP grants: ad-free, a periodic credit allowance, and access to premium narrative variants.

## Webhook to /grant mapping (idempotent)
1. Stripe sends `checkout.session.completed` (coin packs) and `invoice.paid` (VIP renewals).
2. The webhook handler reads the line item price, resolves `price.metadata.coin_amount` (packs) or `credit_allowance` (VIP).
3. It calls economy `/grant` with:
   - `user_id`: from `client_reference_id` or the Stripe customer metadata `app_user_id`.
   - `amount`: the resolved coin count.
   - `type`: `iap` for packs, `subscription` for VIP allowance.
   - `client_txn_id`: the Stripe event id (`evt_...`). This is the idempotency key, so a redelivered webhook never double-grants. It maps directly onto `coin_transactions.UNIQUE (user_id, client_txn_id)`.
4. Verify the Stripe webhook signature. Never grant on an unverified event.

This keeps the ledger server-authoritative: the client never tells the server how many coins to grant. The catalog and the Stripe event are the source of truth.

## Runbook : create in TEST mode
Run these against a test secret key (or after switching the connector to a test key). Create each product, then a price referencing it.

Create a product (operation PostProducts):
name: "Axessplayer Coins, Plus"

type: "service"

metadata.platform: "axessplayer"

metadata.kind: "coin_pack"
Create its price (operation PostPrices):
product: <product_id from the step above>

currency: "usd"

unit_amount: 499                 # cents

metadata.coin_amount: "550"
For VIP, the price adds recurring:
product: <vip_product_id>

currency: "usd"

unit_amount: 1999

recurring.interval: "month"

metadata.tier: "vip"

metadata.credit_allowance: "1800"
Repeat for every row in the tables above. Record the returned price ids in the W2 economy config so the webhook can map price to grant.

## Ownership
W2 (economy) owns the webhook handler, the price to coin mapping, and signature verification. W11 owns the Stripe environment keys (test and live) and the webhook endpoint config. W6w (web app) owns Stripe Checkout on the client.

## To have these created for you
If you connect a Stripe test key (or confirm a restricted test key) to this workspace, the catalog above can be created directly in test mode in one pass. Live creation, if ever requested, goes through Stripe's human approval step and requires explicit per-price confirmation.
