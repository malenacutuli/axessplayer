// Shared test fixtures + fakes for the mobile app tests. A fake ApiClient and a sample content-graph json
// (the shape GET /series/{id}/graph returns), plus a sample wallet. Kept dependency-free. No em dashes.

import type { ApiClient } from "../api/client.js";
import type { Wallet } from "../api/types.js";

export const SERIES_ID = "11111111-1111-1111-1111-111111111111";
export const EP1_ID = "22222222-2222-2222-2222-222222222221";
export const EP2_ID = "22222222-2222-2222-2222-222222222222";
export const COLD_OPEN_BEAT = "33333333-3333-3333-3333-333333333331";
export const PREMIUM_BEAT = "33333333-3333-3333-3333-333333333332";
export const PREMIUM_VARIANT = "44444444-4444-4444-4444-444444444442";

// A raw series-graph payload as the content service would return it (untyped in the contract). Episode 1
// has a cold-open beat with two language variants (one fully accessible) and a premium beat.
export function sampleSeriesGraph(): unknown {
  return {
    id: SERIES_ID,
    title: "The Long Night",
    episodes: [
      {
        id: EP1_ID,
        episode_number: 1,
        title: "Cold Open",
        is_free: true,
        cold_open_beat_id: COLD_OPEN_BEAT,
        beats: [
          {
            id: COLD_OPEN_BEAT,
            is_cold_open: true,
            variants: [
              { id: "44444444-4444-4444-4444-444444444401", language: "en", captions: false },
              {
                id: "44444444-4444-4444-4444-444444444402",
                language: "es",
                captions: true,
                audio_description: true,
                sign: true,
              },
            ],
          },
          {
            id: PREMIUM_BEAT,
            variants: [
              {
                id: PREMIUM_VARIANT,
                language: "en",
                captions: true,
                is_premium: true,
                coin_cost: 50,
              },
            ],
          },
        ],
      },
      {
        id: EP2_ID,
        episode_number: 2,
        title: "Aftermath",
        is_free: false,
        coin_cost: 80,
        beats: [],
      },
    ],
  };
}

export function sampleWallet(overrides: Partial<Wallet> = {}): Wallet {
  return {
    user_id: "99999999-9999-9999-9999-999999999999",
    balance: 100,
    bonus_balance: 20,
    entitlements: [],
    ...overrides,
  };
}

// A fake ApiClient with overridable behavior, for the logic-layer tests.
export function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getWallet: async () => sampleWallet(),
    spend: async () => ({
      balance: 50,
      entitlement: { scope: "beat_variant", scope_id: PREMIUM_VARIANT },
    }),
    getSeriesGraph: async () => sampleSeriesGraph(),
    ...overrides,
  };
}
