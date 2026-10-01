// Tipping (coins) against the economy service: POST {ECONOMY_BASE}/tips { video_id, coins }. Signed in
// only: the UI hides the tip button for guests and this client refuses to send without a token. The body
// never carries a user id (the acting user is the bearer subject, F1). Each tip intent carries an
// Idempotency-Key header so a retried tap cannot double-spend; the server stays authoritative for the
// balance. The endpoint may 404 today, which maps to "coming_soon". No em dashes.

import { createHttp, type HttpOptions } from "../api/http";
import { defaultUuid, type IdFactory } from "../id";

export const TIP_PRESETS = [10, 50, 100] as const;
export const MAX_TIP_COINS = 10000;

export type TipOutcome =
  | { status: "sent" }
  | { status: "coming_soon" }
  | { status: "auth_required" }
  | { status: "insufficient_funds" }
  | { status: "invalid" }
  | { status: "error" };

export function isValidTip(coins: number): boolean {
  return Number.isInteger(coins) && coins > 0 && coins <= MAX_TIP_COINS;
}

export interface TipsClient {
  // idempotencyKey: reuse the same key when retrying the same tap.
  sendTip(videoId: string, coins: number, idempotencyKey?: string): Promise<TipOutcome>;
}

export function createTipsClient(baseUrl: string, opts: HttpOptions & { newId?: IdFactory }): TipsClient {
  const http = createHttp(opts);
  const base = baseUrl.replace(/\/+$/, "");
  const newId = opts.newId ?? defaultUuid;
  return {
    async sendTip(videoId, coins, idempotencyKey) {
      if (!videoId || !isValidTip(coins)) return { status: "invalid" };
      const token = await opts.getAccessToken();
      if (!token) return { status: "auth_required" };
      const res = await http.request(
        {
          method: "POST",
          url: `${base}/tips`,
          body: { video_id: videoId, coins },
          headers: { "idempotency-key": idempotencyKey ?? newId() },
        },
        () => true
      );
      if (res.ok) return { status: "sent" };
      if (res.reason === "not_found") return { status: "coming_soon" };
      if (res.reason === "unauthorized") return { status: "auth_required" };
      if (res.status === 402) return { status: "insufficient_funds" };
      return { status: "error" };
    },
  };
}
