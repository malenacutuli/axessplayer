// Rewards client: triggers the SERVER-SIDE reward callbacks (rewarded ad, daily check-in, follow bonus).
// The browser NEVER mints coins. It calls the settlement service, which verifies and calls economy /grant
// service-to-service (idempotent by client_txn_id). In production the rewarded-ad completion is the ad
// network's signed server-side verification (SSV) callback; in dev the client posts the completion to the
// same endpoint. The daily cap is enforced server-side and surfaced here for display. No em dashes.

export interface RewardResult {
  granted: boolean;
  balance?: number;
  capReached?: boolean;
  cap?: number;
  today?: number;
}

export interface CoinPack {
  id: string;
  coins: number;
  priceUsd: number;
}
export interface SubTier {
  id: string;
  label: string;
  priceUsd: number;
  coinsPerMonth: number;
}
export interface PaywallPresentation {
  path: "watch_ad" | "buy" | "subscribe";
  propensity: number;
  paths: Array<"watch_ad" | "buy" | "subscribe">;
  offers: CoinPack[];
  tiers: SubTier[];
  draft: boolean;
  revenueOptimized: boolean;
}

export interface RewardsClient {
  watchRewardedAd(userId: string, impressionId: string): Promise<RewardResult>;
  checkin(userId: string): Promise<RewardResult>;
  follow(userId: string): Promise<RewardResult>;
  adsToday(userId: string): Promise<{ count: number; cap: number }>;
  // The bandit-chosen paywall presentation (DRAFT weights, propensity logged server-side).
  presentPaywall(input: { userId: string; seriesId?: string; beatVariantId?: string; sessionId?: string }): Promise<PaywallPresentation>;
}

export interface RewardsClientOptions {
  // Settlement service prefix; "" routes same-origin through the Vite proxy (/reward/*).
  rewardsBaseUrl?: string;
  // Content service prefix for the read-only daily-ad count (/admin/ads-today).
  contentBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  dailyAdCap?: number;
}

export const DEFAULT_DAILY_AD_CAP = 5;

export function createRewardsClient(opts: RewardsClientOptions = {}): RewardsClient {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const rb = (opts.rewardsBaseUrl ?? "").replace(/\/$/, "");
  const cb = (opts.contentBaseUrl ?? "").replace(/\/$/, "");
  const cap = opts.dailyAdCap ?? DEFAULT_DAILY_AD_CAP;

  const post = async (path: string, body: Record<string, unknown>): Promise<RewardResult> => {
    const res = await doFetch(`${rb}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 429) {
      return { granted: false, capReached: true, cap: Number(json.cap ?? cap), today: Number(json.today ?? cap) };
    }
    if (!res.ok) throw new Error(`reward failed (${res.status})`);
    return { granted: Boolean(json.granted), balance: typeof json.balance === "number" ? json.balance : undefined };
  };

  return {
    watchRewardedAd: (userId, impressionId) => post("/reward/ad", { userId, impressionId, verified: true }),
    checkin: (userId) => post("/reward/checkin", { userId }),
    follow: (userId) => post("/reward/follow", { userId }),
    async presentPaywall(input) {
      const res = await doFetch(`${rb}/paywall/present`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`paywall present failed (${res.status})`);
      return (await res.json()) as PaywallPresentation;
    },
    async adsToday(userId) {
      try {
        const res = await doFetch(`${cb}/admin/ads-today/${encodeURIComponent(userId)}`);
        const json = (await res.json().catch(() => ({}))) as { count?: number };
        return { count: typeof json.count === "number" ? json.count : 0, cap };
      } catch {
        return { count: 0, cap };
      }
    },
  };
}
