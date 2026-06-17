// Served entry point for grant settlement. The real GrantSink POSTs the economy /grant RPC service-to-
// service with ECONOMY_SERVICE_SECRET (the contract dedupes by client_txn_id). Coins are the in-app
// currency; this does not touch a live card rail. Stripe stays TEST MODE. No em dashes.

import { createSettlementServer, type GrantSink, type PaywallPresentation } from "./server.js";
import type { GrantRequest } from "./grant.js";

const economyBase = (process.env.ECONOMY_BASE_URL ?? "http://127.0.0.1:8091").replace(/\/$/, "");
const serviceSecret = process.env.ECONOMY_SERVICE_SECRET;
if (!serviceSecret) {
  throw new Error("grant settlement: ECONOMY_SERVICE_SECRET is required (service-to-service /grant auth)");
}

const economySink: GrantSink = {
  async grant(req: GrantRequest) {
    const res = await fetch(`${economyBase}/grant`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${serviceSecret}` },
      body: JSON.stringify({ user_id: req.userId, amount: req.amount, type: req.type, client_txn_id: req.clientTxnId }),
    });
    if (!res.ok) throw new Error(`economy /grant failed (${res.status})`);
    const body = (await res.json()) as { balance: number };
    return { balance: body.balance };
  },
};

// Server-side daily rewarded-ad cap input: read today's rewarded_ad count from the content service's
// read-only ledger aggregate. The cap is checked before any mint, so the client cannot exceed it.
const contentBase = (process.env.CONTENT_BASE_URL ?? "http://127.0.0.1:8093").replace(/\/$/, "");
const adsGrantedToday = async (userId: string, dayIso: string): Promise<number> => {
  try {
    const res = await fetch(`${contentBase}/admin/ads-today/${encodeURIComponent(userId)}?day=${dayIso}`);
    if (!res.ok) return 0; // fail-open on a flaky count read; never block a legitimate reward
    const body = (await res.json()) as { count?: number };
    return typeof body.count === "number" ? body.count : 0;
  } catch {
    return 0;
  }
};

// Propensity logging: write each paywall presentation to the content service's append-only events stream.
const logPaywall = async (e: PaywallPresentation): Promise<void> => {
  await fetch(`${contentBase}/admin/paywall-event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(e),
  }).catch(() => {});
};

// Daily rewarded-ad cap is configurable (GOLD_STANDARD_04: 5 to 7); defaults to the rewards module value.
const dailyAdCap = process.env.DAILY_AD_CAP ? Number(process.env.DAILY_AD_CAP) : undefined;

const port = Number(process.env.PORT ?? 8100);
// Default 0.0.0.0 (not 127.0.0.1) so a container port map / Render's port scan can reach the listener; a
// process bound to localhost only answers inside the container and Render reports "No open ports detected".
// Mirrors the other services (content/decision/economy/manifest). Override with HOST for local-only binds.
const host = process.env.HOST ?? "0.0.0.0";
createSettlementServer(economySink, { adsGrantedToday, logPaywall, ...(dailyAdCap ? { dailyAdCap } : {}) }).listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`grant settlement listening on ${host}:${port} (economy ${economyBase}, content ${contentBase}, Stripe TEST mode only)`);
});
