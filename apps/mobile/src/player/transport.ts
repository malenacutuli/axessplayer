// Wire the player SDK's HTTP transport with the app's session bearer. We reuse player-sdk's
// createHttpTransport (W5's boundary) verbatim and only inject a fetch that attaches the bearer to every
// /decide and /manifest call, so the decision + manifest services see the session subject the same way
// economy does.
//
// F1 note (decision contract vs economy 0.3.2). The economy contract (/wallet, /spend) has NO user_id
// field: the app client enforces that. The DECISION contract (decision.yaml v0.3.1) still REQUIRES
// user_id in the /decide body, and player-sdk's BranchingPlayer composes that body internally. That body
// is owned by the frozen decision contract and the W5 SDK, both read-only for this lane, so we do not
// alter it; we DO flag the inconsistency with economy 0.3.2 as a contract-change request in the report
// (decision.yaml should drop body user_id and read the session subject like economy does). The app's own
// bodies (everything in src/api/client.ts) carry no user_id. No em dashes.

import { createHttpTransport, type Transport } from "@axessplayer/player-sdk";

import type { AppConfig } from "../api/config.js";

// A fetch wrapper that attaches the session bearer. Reused for the SDK transport so identity travels the
// same way on /decide and /manifest as on /wallet and /spend.
export function bearerFetch(config: AppConfig): typeof globalThis.fetch {
  const base = config.fetch ?? globalThis.fetch;
  if (typeof base !== "function") {
    throw new Error("no fetch available: pass config.fetch on this runtime");
  }
  const wrapped: typeof globalThis.fetch = async (input, init) => {
    const token = await config.getBearer();
    const headers = new Headers(init?.headers);
    if (token) headers.set("authorization", `Bearer ${token}`);
    return base(input, { ...init, headers });
  };
  return wrapped;
}

// Build the SDK transport pointed at the configured decision + manifest origins with the bearer attached.
export function createPlayerTransport(config: AppConfig): Transport {
  return createHttpTransport({
    decisionBaseUrl: config.baseUrls.decision,
    manifestBaseUrl: config.baseUrls.manifest,
    fetch: bearerFetch(config),
  });
}
