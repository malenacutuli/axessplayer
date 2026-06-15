// The transport boundary: the two network calls the runtime makes, behind one injectable interface
// so the prefetch + switch logic is testable with a fake and runnable against the Prism mocks of
// decision + manifest. The real web target wires this to fetch() (hls.js for the media), and the
// native target to the platform HTTP stack feeding ExoPlayer/AVPlayer. No em dashes.

import type { DecideRequest, DecideResponse, VariantId } from "./types.js";

// Raised when /decide returns the contract 422 (end of graph, no successor variants). The runtime
// treats this as "play to the ending"; it is not an error to retry.
export class NoSuccessorsError extends Error {
  readonly status = 422 as const;
  constructor() {
    super("no_successors");
    this.name = "NoSuccessorsError";
  }
}

// Raised when the manifest service has no variant with that id (contract 404). A prefetch that hits
// this is dropped from the candidate set, not fatal: the runtime can still serve the default cut.
export class VariantNotFoundError extends Error {
  readonly status = 404 as const;
  constructor(readonly variantId: VariantId) {
    super("variant_not_found");
    this.name = "VariantNotFoundError";
  }
}

export interface Transport {
  // POST /decide at a beat boundary. Resolves with the 200 body or rejects NoSuccessorsError on 422.
  decide(req: DecideRequest): Promise<DecideResponse>;
  // GET /manifest/{variant_id}.m3u8. Resolves with the HLS playlist text or rejects
  // VariantNotFoundError on 404. Used for the chosen cut and each prefetch hint.
  fetchManifest(variantId: VariantId): Promise<string>;
}

// An HTTP transport over fetch, for the web target and for the Prism-mock integration test. Kept
// dependency-free (global fetch, Node 20+ / browsers). The base url points at the decision and
// manifest services (or one Prism gateway in the mock environment).
export interface HttpTransportOptions {
  // Base url for /decide (decision service).
  decisionBaseUrl: string;
  // Base url for /manifest/{id}.m3u8 (manifest service). Often the same origin behind a gateway.
  manifestBaseUrl: string;
  // Injectable for tests; defaults to the global fetch.
  fetch?: typeof globalThis.fetch;
}

export function createHttpTransport(opts: HttpTransportOptions): Transport {
  const doFetch = opts.fetch ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new Error("no fetch available: pass opts.fetch on this runtime");
  }
  const decisionBase = trimSlash(opts.decisionBaseUrl);
  const manifestBase = trimSlash(opts.manifestBaseUrl);

  return {
    async decide(req: DecideRequest): Promise<DecideResponse> {
      const res = await doFetch(`${decisionBase}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      });
      if (res.status === 422) throw new NoSuccessorsError();
      if (!res.ok) throw new Error(`decide failed: ${res.status}`);
      return (await res.json()) as DecideResponse;
    },
    async fetchManifest(variantId: VariantId): Promise<string> {
      const res = await doFetch(`${manifestBase}/manifest/${variantId}.m3u8`);
      if (res.status === 404) throw new VariantNotFoundError(variantId);
      if (!res.ok) throw new Error(`manifest failed: ${res.status} for ${variantId}`);
      return await res.text();
    },
  };
}

function trimSlash(u: string): string {
  return u.endsWith("/") ? u.slice(0, -1) : u;
}
