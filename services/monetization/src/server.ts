// Grant settlement surface (money go-live boundary, unblocked by the money/ledger founder sign-off).
// Turns verified earn/purchase events into idempotent grants and sends them to the economy ledger via a
// pluggable GrantSink (the real sink calls economy /grant service-to-service; tests use a fake). Coins are
// the in-app currency; this never touches a live card rail. Stripe is TEST MODE ONLY: a livemode session
// is refused. No em dashes.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { isGrant, type GrantRequest } from "./grant.js";
import { settleCheckin, settleRewardedAd, settleFollow, DAILY_AD_CAP, type AdReward } from "./rewards.js";
import { grantFromCheckout, verifyStripeSignature, type StripeEvent } from "./stripe.js";
import {
  DEFAULT_OFFERS,
  selectPaywallPath,
  PAYWALL_PATHS,
  DRAFT_PATH_WEIGHTS,
  SUBSCRIPTION_TIERS,
  REWARD_WEIGHTS_SIGNED_OFF,
  type Offer,
} from "./paywall.js";

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

async function readRaw(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const raw = await readRaw(req);
  return (raw ? JSON.parse(raw) : {}) as T;
}

// UTC day for the daily check-in idempotency key. Server-authoritative so a client cannot claim twice.
function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

// Optional server-side guards. adsGrantedToday counts a user's rewarded_ad grants for the given UTC day
// from the ledger so the daily cap is enforced server-side (never trusted from the client). Injected so
// tests stay pure; serve.ts wires a read-only ledger count.
// A paywall presentation event: the bandit's choice + its logged propensity, for off-policy evaluation.
// No price is mutated here; the offers/tiers carry transparent prices to the client.
export interface PaywallPresentation {
  eventId: string;
  userId: string;
  seriesId?: string;
  beatVariantId?: string;
  sessionId: string;
  path: string;
  propensity: number;
  paths: string[];
  draft: boolean;
  revenueOptimized: boolean;
}

export interface SettlementOptions {
  offers?: Offer[];
  adsGrantedToday?: (userId: string, dayIso: string) => Promise<number>;
  dailyAdCap?: number;
  // Logs a paywall presentation (propensity) to the events store. Injected so tests stay pure; serve.ts
  // wires it to the content service's append-only engagement_events.
  logPaywall?: (e: PaywallPresentation) => Promise<void>;
  // Deterministic rng for the path bandit in tests. Defaults to Math.random in production.
  rng?: () => number;
  // Stripe endpoint signing secret (whsec_...). Without it the webhook refuses every request (fail closed):
  // an unsigned body must never mint coins.
  stripeWebhookSecret?: string;
}

export function createSettlementServer(sink: GrantSink, opts: SettlementOptions = {}): Server {
  const offers = opts.offers ?? DEFAULT_OFFERS;
  const dailyAdCap = opts.dailyAdCap ?? DAILY_AD_CAP;
  const rng = opts.rng ?? Math.random;
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
          // Server-side daily cap: count today's rewarded_ad grants from the ledger and refuse over the cap
          // BEFORE minting. The client cannot bypass it (it never holds the grant secret). A capped request
          // is a clean 429, not a silent no-op, so the UI can show the cap.
          if (r.userId && opts.adsGrantedToday) {
            const today = await opts.adsGrantedToday(r.userId, utcDay());
            if (today >= dailyAdCap) {
              return send(res, 429, { error: "daily_cap_reached", cap: dailyAdCap, today });
            }
          }
          return await settle(res,settleRewardedAd(r));
        }
        if (method === "POST" && path === "/reward/checkin") {
          const { userId } = await readJson<{ userId: string }>(req);
          if (!userId) return send(res, 400, { error: "userId required" });
          return await settle(res,settleCheckin(userId, utcDay()));
        }
        if (method === "POST" && path === "/reward/follow") {
          const { userId } = await readJson<{ userId: string }>(req);
          if (!userId) return send(res, 400, { error: "userId required" });
          return await settle(res,settleFollow(userId));
        }
        if (method === "POST" && path === "/paywall/present") {
          const body = await readJson<{ userId?: string; seriesId?: string; beatVariantId?: string; sessionId?: string }>(req);
          if (!body.userId) return send(res, 400, { error: "userId required" });
          // DRAFT bandit: neutral weights, no revenue optimization until the reward-weights sign-off.
          const sel = selectPaywallPath(PAYWALL_PATHS, DRAFT_PATH_WEIGHTS, 0.2, rng);
          const sessionId = body.sessionId || `sess-${body.userId}`;
          const eventId = `pw-${Date.now()}-${Math.floor(rng() * 1e9)}`;
          if (opts.logPaywall) {
            // Best effort: a log failure must not block the viewer's paywall.
            await opts
              .logPaywall({
                eventId,
                userId: body.userId,
                ...(body.seriesId ? { seriesId: body.seriesId } : {}),
                ...(body.beatVariantId ? { beatVariantId: body.beatVariantId } : {}),
                sessionId,
                path: sel.path,
                propensity: sel.propensity,
                paths: PAYWALL_PATHS,
                draft: !REWARD_WEIGHTS_SIGNED_OFF,
                revenueOptimized: sel.revenueOptimized,
              })
              .catch(() => {});
          }
          return send(res, 200, {
            path: sel.path,
            propensity: sel.propensity,
            explored: sel.explored,
            paths: PAYWALL_PATHS,
            offers,
            tiers: SUBSCRIPTION_TIERS,
            draft: !REWARD_WEIGHTS_SIGNED_OFF,
            optimized: sel.optimized,
            revenueOptimized: sel.revenueOptimized,
            eventId,
          });
        }
        if (method === "POST" && path === "/stripe/webhook") {
          if (!opts.stripeWebhookSecret) return send(res, 503, { error: "stripe webhook not configured" });
          const raw = await readRaw(req);
          const sig = req.headers["stripe-signature"];
          if (!verifyStripeSignature(raw, Array.isArray(sig) ? sig[0] : sig, opts.stripeWebhookSecret)) {
            return send(res, 400, { error: "invalid stripe signature" });
          }
          const event = JSON.parse(raw) as StripeEvent;
          if (event.type !== "checkout.session.completed" || !event.data?.object) {
            return send(res, 200, { granted: false, skipped: `ignored event ${event.type ?? "unknown"}` });
          }
          return await settle(res, grantFromCheckout(event.data.object, offers)); // livemode refused inside (test mode only)
        }
        send(res, 404, { error: "not found" });
      } catch (e) {
        if (!res.headersSent) send(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    })();
  });
}
