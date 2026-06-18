// Creator revenue-share math for the admin creator/payout surfaces. PURE: no DB, no I/O. The platform
// operates a 70/30 split (creator keeps 70%, platform takes 30%) on gross creator revenue. This helper is
// the single source of truth for that split so the console, a future payout export, and any reporting all
// compute it identically. It is unit-tested. No em dashes.
//
// HARD GATE: this is a creator-revenue computation only. It never reads ad-plane (brand/campaign) money and
// never crosses into content ranking. It takes a gross integer (coins or minor currency units) and returns
// the integer split. Display-only this wave: no payout is executed, this only computes what a payout WOULD
// be.

// The fixed split. 70% creator / 30% platform. Expressed as a single source so a change is one edit.
export const CREATOR_SHARE = 0.7;
export const PLATFORM_SHARE = 0.3;

export interface RevenueSplit {
  // The gross echoed back, so a caller carrying the split alone still knows the base it was computed from.
  gross: number;
  // The creator's cut (70%), floored to a whole unit. Coins/minor units are integers; fractional units are
  // not payable, so the creator share is floored and the remainder is assigned to the platform. This makes
  // creator + platform === gross exactly, with no rounding leak in either direction.
  creator: number;
  // The platform's cut: the remainder (gross - creator). At the canonical 70/30 this is >= 30% of gross by
  // at most the floored sub-unit, never less, so the platform never overpays the creator a fractional unit.
  platform: number;
}

// Compute the 70/30 split of a gross amount. gross is clamped to a non-negative integer first: a negative
// or fractional gross is not a real payable amount, so it is normalized (negative -> 0, fractional ->
// floored) rather than propagated. creator is floor(gross * 0.7); platform is the exact remainder so the
// two always sum to gross with zero rounding leak.
export function revenueShare(gross: number): RevenueSplit {
  const g = Number.isFinite(gross) ? Math.max(0, Math.floor(gross)) : 0;
  const creator = Math.floor(g * CREATOR_SHARE);
  const platform = g - creator;
  return { gross: g, creator, platform };
}
