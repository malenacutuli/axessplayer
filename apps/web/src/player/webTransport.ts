// The web playback transport. It implements the player-sdk Transport interface (the two network
// calls the branching runtime makes) so the shared decision + prefetch + seamless-switch logic in
// packages/player-sdk drives web playback unchanged. We provide our OWN implementation rather than
// the SDK's createHttpTransport for two reasons:
//
//   1. F1: the SDK's DecideRequest type carries user_id because the decision contract is still at
//      v0.3.1 (it requires user_id in the body). This web client NEVER sends user_id in a body. We
//      strip it here and attach the session bearer instead, so identity rides the token. The drop is
//      logged so the F1 divergence from the 0.3.1 decision contract is visible, not silent. A
//      contract-change request to lift decision to the 0.3.2 F1 shape is filed in the report.
//   2. Auth: every call carries the session token.
//
// Device-level frame-accurate playback (hls.js + MSE buffering, the on-hardware seamless cut) is W5's
// runtime behind this interface; here we resolve the contract calls and let the SDK orchestrate.
// That media-stack wiring is flagged as integration-time, not faked. No em dashes.

import {
  NoSuccessorsError,
  VariantNotFoundError,
  type Transport,
} from "@axessplayer/player-sdk";
import type {
  DecideRequest,
  DecideResponse,
} from "@axessplayer/player-sdk";
import { authHeader, type SessionProvider } from "../api/session.js";

export interface WebTransportOptions {
  decisionBaseUrl: string;
  manifestBaseUrl: string;
  session: SessionProvider;
  fetch?: typeof globalThis.fetch;
  // Hook so the host can observe that user_id was stripped (diagnostics / the F1 assertion in tests).
  onStripUserId?: (stripped: string) => void;
}

export function createWebTransport(opts: WebTransportOptions): Transport {
  // Bind to the receiver: a bare global fetch reference is detached and the browser's fetch is
  // unforgeable, so an unbound call throws "Illegal invocation". See apps/web/src/api/http.ts.
  const globalFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : undefined;
  const doFetch = opts.fetch ?? globalFetch;
  if (typeof doFetch !== "function") {
    throw new Error("no fetch available: pass opts.fetch on this runtime");
  }
  const decisionBase = trimSlash(opts.decisionBaseUrl);
  const manifestBase = trimSlash(opts.manifestBaseUrl);

  return {
    async decide(req: DecideRequest): Promise<DecideResponse> {
      // F1: drop user_id. Identity is the session subject from the bearer token. The contract type
      // still includes it (decision 0.3.1), so we destructure it off the body before serializing.
      const { user_id, ...bodyWithoutUserId } = req as DecideRequest & { user_id?: string };
      if (user_id !== undefined) opts.onStripUserId?.(user_id);

      const res = await doFetch(`${decisionBase}/decide`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(await authHeader(opts.session)),
        },
        body: JSON.stringify(bodyWithoutUserId),
      });
      if (res.status === 422) throw new NoSuccessorsError();
      if (!res.ok) throw new Error(`decide failed: ${res.status}`);
      return (await res.json()) as DecideResponse;
    },

    async fetchManifest(variantId: string): Promise<string> {
      const res = await doFetch(`${manifestBase}/manifest/${variantId}.m3u8`, {
        headers: { ...(await authHeader(opts.session)) },
      });
      if (res.status === 404) throw new VariantNotFoundError(variantId);
      if (!res.ok) throw new Error(`manifest failed: ${res.status} for ${variantId}`);
      return await res.text();
    },
  };
}

function trimSlash(u: string): string {
  return u.endsWith("/") ? u.slice(0, -1) : u;
}
