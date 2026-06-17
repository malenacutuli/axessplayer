// Grant settlement surface (money go-live boundary, unblocked by the money/ledger founder sign-off).
// Turns verified earn/purchase events into idempotent grants and sends them to the economy ledger via a
// pluggable GrantSink (the real sink calls economy /grant service-to-service; tests use a fake). Coins are
// the in-app currency; this never touches a live card rail. Stripe is TEST MODE ONLY: a livemode session
// is refused. No em dashes.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { isGrant, type GrantRequest } from "./grant.js";
import { settleCheckin, settleRewardedAd, type AdReward } from "./rewards.js";
import { grantFromCheckout, type CheckoutSession } from "./stripe.js";
import { DEFAULT_OFFERS, type Offer } from "./paywall.js";

// The ledger sink. The real implementation POSTs economy /grant with the service secret; the contract
// dedupes by (user_id, client_txn_id) so a replayed settlement is a server-side no-op.
export interface GrantSink {
  grant(req: GrantRequest): Promise<{ balance: number }>;
}

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, accept",
};

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...CORS });
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return (raw ? JSON.parse(raw) : {}) as T;
}

// UTC day for the daily check-in idempotency key. Server-authoritative so a client cannot claim twice.
function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function createSettlementServer(sink: GrantSink, offers: Offer[] = DEFAULT_OFFERS): Server {
  const settle = async (res: ServerResponse, g: GrantRequest | { skip: string }) => {
    if (!isGrant(g)) return send(res, 200, { granted: false, skipped: g.skip });
    const out = await sink.grant(g);
    return send(res, 200, { granted: true, type: g.type, amount: g.amount, client_txn_id: g.clientTxnId, balance: out.balance });
  };
  return createServer((req, res) => {
    void (async () => {
      try {
        const method = (req.method ?? "GET").toUpperCase();
        const path = (req.url ?? "/").split("?")[0];
        if (method === "OPTIONS") {
          res.writeHead(204, CORS);
          return res.end();
        }
        if (path === "/healthz") return send(res, 200, { ok: true });
        if (method === "POST" && path === "/reward/ad") {
          const r = await readJson<AdReward>(req);
          return settle(res, settleRewardedAd(r));
        }
        if (method === "POST" && path === "/reward/checkin") {
          const { userId } = await readJson<{ userId: string }>(req);
          if (!userId) return send(res, 400, { error: "userId required" });
          return settle(res, settleCheckin(userId, utcDay()));
        }
        if (method === "POST" && path === "/stripe/webhook") {
          const session = await readJson<CheckoutSession>(req);
          return settle(res, grantFromCheckout(session, offers)); // livemode refused inside (test mode only)
        }
        send(res, 404, { error: "not found" });
      } catch (e) {
        if (!res.headersSent) send(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    })();
  });
}
