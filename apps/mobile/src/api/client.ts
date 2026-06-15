// The app's typed fetch client. Mirrors packages/player-sdk/src/transport.ts (createHttpTransport): a
// thin, dependency-free wrapper over fetch behind one injectable interface, so the screens are testable
// with a fake and the integration test can run it against a real test server or the Prism mocks.
//
// Identity model (economy 0.3.2, F1): every call attaches the session bearer via the injected provider.
// The acting user is the bearer subject. The client NEVER writes a user_id into a request body. The
// single mutation helper (postJson) guards this at runtime: it throws if a forbidden key reaches a body,
// so a future caller cannot regress the trust boundary even by mistake. No em dashes.

import type { AppConfig } from "./config.js";
import { trimSlash } from "./config.js";
import type {
  PaywallOptions,
  SpendRequest,
  SpendResult,
  Wallet,
} from "./types.js";

// Raised on a 402 from /spend. Carries the contract PaywallOptions so the screen can present buy / watch
// ad / subscribe. Not an error to log-and-drop: it is the paywall control flow.
export class PaywallRequiredError extends Error {
  readonly status = 402 as const;
  constructor(readonly options: PaywallOptions) {
    super(options.error || "insufficient_funds");
    this.name = "PaywallRequiredError";
  }
}

// Raised when the session is missing or rejected (401). The host should route to sign-in.
export class AuthRequiredError extends Error {
  readonly status = 401 as const;
  constructor() {
    super("auth_required");
    this.name = "AuthRequiredError";
  }
}

// Keys that must never appear in a request body the client sends (F1). user_id is the subject of the
// rule; the others are defense in depth against leaking caller-asserted identity.
const FORBIDDEN_BODY_KEYS = ["user_id", "uid", "subject", "sub"] as const;

export interface ApiClient {
  // GET /wallet -> the session subject's balance + entitlements. No user id is sent (F1).
  getWallet(): Promise<Wallet>;
  // POST /spend -> unlock an episode or premium variant for the session subject. Idempotent on
  // client_txn_id. Rejects PaywallRequiredError on 402. The body carries NO user_id (F1).
  spend(req: SpendRequest): Promise<SpendResult>;
  // GET /series/{id}/graph -> the raw graph json (parsed into a view model by the feed layer).
  getSeriesGraph(seriesId: string): Promise<unknown>;
}

export function createApiClient(config: AppConfig): ApiClient {
  const doFetch = config.fetch ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new Error("no fetch available: pass config.fetch on this runtime");
  }
  const economy = trimSlash(config.baseUrls.economy);
  const content = trimSlash(config.baseUrls.content);

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await config.getBearer();
    if (!token) throw new AuthRequiredError();
    return { authorization: `Bearer ${token}` };
  }

  async function getJson<T>(url: string): Promise<T> {
    const res = await doFetch(url, {
      method: "GET",
      headers: { accept: "application/json", ...(await authHeaders()) },
    });
    if (res.status === 401) throw new AuthRequiredError();
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  // The only mutation path. Runtime-guards the F1 trust boundary: a forbidden identity key in the body
  // is a programming error and throws before the request leaves the device.
  async function postJson<T>(url: string, body: object): Promise<T> {
    assertNoForbiddenKeys(body);
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(await authHeaders()),
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new AuthRequiredError();
    if (res.status === 402) {
      throw new PaywallRequiredError((await res.json()) as PaywallOptions);
    }
    if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    getWallet: () => getJson<Wallet>(`${economy}/wallet`),
    spend: (req) => postJson<SpendResult>(`${economy}/spend`, req),
    getSeriesGraph: (seriesId) =>
      getJson<unknown>(`${content}/series/${encodeURIComponent(seriesId)}/graph`),
  };
}

// Throws if any forbidden identity key appears at the top level of an outgoing body. Kept top-level
// (not deep) on purpose: the contract bodies are flat, and a deep walk would invite false positives on
// legitimately nested data later. Exported for the F1 test to exercise directly.
export function assertNoForbiddenKeys(body: object): void {
  for (const key of FORBIDDEN_BODY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      throw new Error(
        `F1 violation: request body must not carry "${key}" (identity is the session subject, economy 0.3.2)`
      );
    }
  }
}
