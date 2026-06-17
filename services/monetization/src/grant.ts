// The shared grant request shape. A GrantRequest is what the monetization logic PRODUCES; calling the
// economy /grant RPC with it is the fenced boundary that goes live only after the money/ledger founder
// sign-off. grant types mirror the economy contract (iap, rewarded_ad, offer_wall, checkin, refund).
// Idempotency is by (user_id, client_txn_id) at the ledger, so a re-submitted reward or purchase is a
// server-side no-op. No em dashes.

export type GrantType = "iap" | "rewarded_ad" | "offer_wall" | "checkin" | "refund";

export type GrantRequest = {
  userId: string;
  amount: number; // positive coins
  type: GrantType;
  clientTxnId: string; // idempotency key
};

export type Skip = { skip: string };

export function isGrant(x: GrantRequest | Skip): x is GrantRequest {
  return (x as GrantRequest).amount !== undefined;
}
