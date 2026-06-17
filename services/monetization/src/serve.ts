// Served entry point for grant settlement. The real GrantSink POSTs the economy /grant RPC service-to-
// service with ECONOMY_SERVICE_SECRET (the contract dedupes by client_txn_id). Coins are the in-app
// currency; this does not touch a live card rail. Stripe stays TEST MODE. No em dashes.

import { createSettlementServer, type GrantSink } from "./server.js";
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

const port = Number(process.env.PORT ?? 8100);
const host = process.env.HOST ?? "127.0.0.1";
createSettlementServer(economySink).listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`grant settlement listening on ${host}:${port} (economy ${economyBase}, Stripe TEST mode only)`);
});
