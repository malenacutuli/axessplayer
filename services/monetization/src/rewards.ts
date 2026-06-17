// P6-T2 reward settlement. Turns a verified reward event (a rewarded-ad completion or a daily check-in)
// into an idempotent GrantRequest. Coins are minted ONLY by the server calling /grant (a client cannot
// mint coins, F-economy), and idempotency is by client_txn_id at the ledger: a daily check-in is once per
// UTC day, a rewarded ad is once per verified ad impression. Amounts are flagged for the money sign-off.
// No em dashes.

import type { GrantRequest, Skip } from "./grant.js";

// FLAGGED for the money/ledger founder sign-off. GOLD_STANDARD_04: a rewarded ad is 25 coins. The daily
// check-in and one-time follow bonus amounts are flagged placeholders.
export const REWARD_AMOUNTS = { rewarded_ad: 25, checkin: 5, follow: 25 } as const;

// Daily rewarded-ad cap (GOLD_STANDARD_04: 5 to 7 per day). Enforced server-side against the ledger (count
// of today's rewarded_ad grants), never trusted from the client.
export const DAILY_AD_CAP = 5;

// Daily check-in idempotency: one per user per UTC day. Pass the day as YYYY-MM-DD (caller derives it; no
// hidden clock here so it is deterministic and testable).
export function checkinTxnId(userId: string, dayIso: string): string {
  return `checkin:${userId}:${dayIso}`;
}

export function settleCheckin(userId: string, dayIso: string): GrantRequest {
  return { userId, amount: REWARD_AMOUNTS.checkin, type: "checkin", clientTxnId: checkinTxnId(userId, dayIso) };
}

// One-time follow bonus: granted once per user, ever. Idempotent by a fixed per-user key so a replay is a
// ledger no-op. Typed offer_wall (an engagement reward) so it is distinct from check-ins in the ledger.
export function settleFollow(userId: string): GrantRequest {
  return { userId, amount: REWARD_AMOUNTS.follow, type: "offer_wall", clientTxnId: `follow:${userId}` };
}

// Forgiving streak (anti-dark-pattern): a missed day never resets the streak to zero. Given the prior
// streak, the last check-in day, and today, return the new streak: unchanged on the same day, +1 when
// consecutive, and at most one step down (floored at 1) when days were missed. Pure and deterministic.
export function forgivingStreak(prevStreak: number, lastDayIso: string | null, todayIso: string): number {
  if (!lastDayIso) return 1;
  if (lastDayIso === todayIso) return Math.max(1, prevStreak);
  const gapDays = Math.round((Date.parse(todayIso) - Date.parse(lastDayIso)) / 86400000);
  if (gapDays <= 1) return prevStreak + 1;
  return Math.max(1, prevStreak - 1);
}

// Rewarded ad: settle only when the ad network verified the completion. The impression id makes it
// idempotent (a replayed callback is a server-side no-op at the ledger). An unverified reward is skipped.
export type AdReward = { userId: string; impressionId: string; verified: boolean };

export function settleRewardedAd(r: AdReward): GrantRequest | Skip {
  if (!r.verified) return { skip: "ad reward not verified by the network" };
  if (!r.impressionId) return { skip: "missing impression id (no idempotency key)" };
  return { userId: r.userId, amount: REWARD_AMOUNTS.rewarded_ad, type: "rewarded_ad", clientTxnId: `ad:${r.impressionId}` };
}
