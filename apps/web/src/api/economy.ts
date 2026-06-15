// The economy client: /wallet and /spend, bound to the frozen economy contract (v0.3.2) generated
// types so a contract change is a typecheck failure here. Both endpoints are session-scoped: there is
// no user_id field by design (F1). /grant is server-to-server only and is intentionally NOT exposed
// from the browser client. No em dashes.

import type { components, operations } from "../../../../contracts/types/generated/economy.js";
import { apiFetch, ApiError } from "./http.js";
import type { SessionProvider } from "./session.js";

export type Wallet = components["schemas"]["Wallet"];
export type Entitlement = components["schemas"]["Entitlement"];
export type PaywallOptions = components["schemas"]["PaywallOptions"];

export type SpendBody = operations["spend"]["requestBody"]["content"]["application/json"];
export type SpendResult = operations["spend"]["responses"][200]["content"]["application/json"];

export interface EconomyClient {
  getWallet(): Promise<Wallet>;
  // Resolves with the new balance + entitlement on 200. On 402 it rejects with PaywallError carrying
  // the contract PaywallOptions so the UI can present buy / watch_ad / subscribe.
  spend(body: SpendBody): Promise<SpendResult>;
}

// Thrown on a 402 from /spend. Carries the contract PaywallOptions so the paywall screen renders the
// exact options the server offered.
export class PaywallError extends Error {
  constructor(readonly options: PaywallOptions) {
    super(options.error || "insufficient_funds");
    this.name = "PaywallError";
  }
}

export interface EconomyClientOptions {
  baseUrl: string;
  session: SessionProvider;
  fetch?: typeof globalThis.fetch;
}

export function createEconomyClient(opts: EconomyClientOptions): EconomyClient {
  const { baseUrl, session } = opts;
  return {
    async getWallet(): Promise<Wallet> {
      return apiFetch<Wallet>(baseUrl, "/wallet", session, { fetch: opts.fetch });
    },
    async spend(body: SpendBody): Promise<SpendResult> {
      try {
        return await apiFetch<SpendResult>(baseUrl, "/spend", session, {
          method: "POST",
          body,
          fetch: opts.fetch,
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 402) {
          throw new PaywallError(err.body as PaywallOptions);
        }
        throw err;
      }
    },
  };
}
