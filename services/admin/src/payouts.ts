// P9 payouts: a creator earnings REPORT computed from ledger spend transactions attributed to a creator's
// content. This is a report only, NEVER a disbursement: paying a creator real money is a money-go-live
// action behind a banking rail (out of scope here). The platform fee / revenue share and the coin USD
// value are FLAGGED placeholders for the money/revenue-share founder decision. No em dashes.

// FLAGGED for the money sign-off / revenue-share decision.
export const PLATFORM_FEE_RATE = 0.3; // platform keeps 30 percent (placeholder)
export const USD_PER_COIN = 0.08; // implied coin value (placeholder)

// A ledger spend attributed to a creator's content (the creator who owns the unlocked scope).
export type AttributedSpend = { creatorId: string; coins: number };

export type PayoutReport = {
  creatorId: string;
  grossCoins: number;
  grossUsd: number;
  platformFeeUsd: number;
  netUsd: number;
};

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function payoutReport(
  creatorId: string,
  spends: AttributedSpend[],
  opts: { feeRate?: number; usdPerCoin?: number } = {},
): PayoutReport {
  const feeRate = opts.feeRate ?? PLATFORM_FEE_RATE;
  const usdPerCoin = opts.usdPerCoin ?? USD_PER_COIN;
  const grossCoins = spends.filter((s) => s.creatorId === creatorId).reduce((sum, s) => sum + s.coins, 0);
  const grossUsd = round2(grossCoins * usdPerCoin);
  const platformFeeUsd = round2(grossUsd * feeRate);
  return { creatorId, grossCoins, grossUsd, platformFeeUsd, netUsd: round2(grossUsd - platformFeeUsd) };
}

// All creators' reports, sorted by net descending (the operator payout view).
export function allPayoutReports(spends: AttributedSpend[], opts?: { feeRate?: number; usdPerCoin?: number }): PayoutReport[] {
  const creators = [...new Set(spends.map((s) => s.creatorId))];
  return creators.map((c) => payoutReport(c, spends, opts)).sort((a, b) => b.netUsd - a.netUsd);
}
