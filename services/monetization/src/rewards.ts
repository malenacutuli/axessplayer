// P6-T2 reward settlement. Turns a verified reward event (a rewarded-ad completion or a daily check-in)
// into an idempotent GrantRequest. Coins are minted ONLY by the server calling /grant (a client cannot
// mint coins, F-economy), and idempotency is by client_txn_id at the ledger: a daily check-in is once per
// UTC day, a rewarded ad is once per verified ad impression. Amounts are flagged for the money sign-off.
// No em dashes.

import type { GrantRequest, Skip } from "./grant.js";

// FLAGGED for the money/ledger founder sign-off.
export const REWARD_AMOUNTS = { rewarded_ad: 2, checkin: 1 } as const;

// Daily check-in idempotency: one per user per UTC day. Pass the day as YYYY-MM-DD (caller derives it; no
// hidden clock here so it is deterministic and testable).
export function checkinTxnId(userId: string, dayIso: string): string {
  return `checkin:${userId}:${dayIso}`;
}

export function settleCheckin(userId: string, dayIso: string): GrantRequest {
  return { userId, amount: REWARD_AMOUNTS.checkin, type: "checkin", clientTxnId: checkinTxnId(userId, dayIso) };
}

// Rewarded ad: settle only when the ad network verified the completion. The impression id makes it
// idempotent (a replayed callback is a server-side no-op at the ledger). An unverified reward is skipped.
export type AdReward = { userId: string; impressionId: string; verified: boolean };

export function settleRewardedAd(r: AdReward): GrantRequest | Skip {
  if (!r.verified) return { skip: "ad reward not verified by the network" };
  if (!r.impressionId) return { skip: "missing impression id (no idempotency key)" };
  return { userId: r.userId, amount: REWARD_AMOUNTS.rewarded_ad, type: "rewarded_ad", clientTxnId: `ad:${r.impressionId}` };
}
