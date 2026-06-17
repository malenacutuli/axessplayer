// P6-T4 Stripe checkout to grant mapping. Maps a COMPLETED Stripe checkout session (a coin-pack purchase)
// to an idempotent GrantRequest. Test mode only: the live Stripe key is fenced and the actual /grant call
// is behind the money/ledger founder sign-off. client_txn_id = the Stripe session id, so a replayed
// webhook is a server-side no-op. Coins come from the founder-approved offer set, never from client input.
// Web/Studio only (the mobile IAP tax keeps real purchasing where the margin survives, C8). No em dashes.

import type { GrantRequest, Skip } from "./grant.js";
import type { Offer } from "./paywall.js";

export type CheckoutSession = {
  id: string;
  // Stripe checkout.session.payment_status; only "paid" grants. mode is "payment" for a one-off pack.
  payment_status: string;
  livemode: boolean;
  metadata?: { userId?: string; offerId?: string };
};

// Map a webhook checkout.session.completed to a grant. Refuses unpaid sessions, missing metadata, an
// unknown offer, and (defensively) a livemode session while the live rail is fenced.
export function grantFromCheckout(session: CheckoutSession, offers: Offer[], opts: { allowLive?: boolean } = {}): GrantRequest | Skip {
  if (session.livemode && !opts.allowLive) return { skip: "livemode session blocked until money sign-off (test mode only)" };
  if (session.payment_status !== "paid") return { skip: `not paid (payment_status=${session.payment_status})` };
  const userId = session.metadata?.userId;
  const offerId = session.metadata?.offerId;
  if (!userId || !offerId) return { skip: "missing userId/offerId metadata" };
  const offer = offers.find((o) => o.id === offerId);
  if (!offer) return { skip: `unknown offer ${offerId}` };
  return { userId, amount: offer.coins, type: "iap", clientTxnId: `stripe:${session.id}` };
}
