// An in-memory mock of the four services for integration tests, in the spirit of the Prism mocks but
// stateful enough to drive the unlock flow end to end. It emulates content (/series/{id}/graph),
// economy (/wallet, /spend with idempotent client_txn_id and 402 on insufficient funds), decision
// (/decide walking the seed graph to a 422 end), and manifest (/manifest/{id}.m3u8).
//
// CRITICAL: it RECORDS every request body it receives so a test can assert that no request body ever
// carries a user_id (F1). It also records whether the Authorization header was present (identity
// rides the token, not the body). No em dashes.

import {
  SERIES_ID,
  BEAT_COLD_OPEN,
  BEAT_BRANCH,
  BEAT_TENSE,
  BEAT_CALM,
  BEAT_ENDING,
  VAR_BRANCHPOINT,
  VAR_TENSE,
  VAR_CALM,
  VAR_ENDING,
  VAR_ENDING_PREMIUM,
  nestedSeedGraph,
} from "./fixtures.js";

export interface RecordedRequest {
  url: string;
  method: string;
  hasAuthHeader: boolean;
  body: unknown;
}

export interface MockServer {
  fetch: typeof globalThis.fetch;
  requests: RecordedRequest[];
  // Every parsed JSON body that was sent in a request (GET bodies excluded). For the F1 assertion.
  bodies(): Array<Record<string, unknown>>;
}

export interface MockServerOptions {
  // Starting wallet balance. The seed gives 10 coins.
  balance?: number;
}

export function createMockServer(opts: MockServerOptions = {}): MockServer {
  const requests: RecordedRequest[] = [];
  let balance = opts.balance ?? 10;
  const entitlements: Array<{ scope: string; scope_id: string }> = [];
  // Idempotency: a repeated client_txn_id is a no-op that returns the prior result.
  const seenTxns = new Map<string, { balance: number; entitlement: { scope: string; scope_id: string } }>();

  // The decision walk, keyed by BEAT id exactly as the real decision service expects: /decide takes
  // current_beat_id and returns the next cut's VARIANT id (it walks beat_edges and joins beat_variants
  // on to_beat_id). The player advances by resolving the chosen variant back to its beat. Ends with a
  // 422 at the ending beat. Models a treatment viewer that branches to the tense cut, then the shared
  // ending.
  const decideNext: Record<string, { next: string; prefetch: string[] } | "end"> = {
    [BEAT_COLD_OPEN]: { next: VAR_BRANCHPOINT, prefetch: [] }, // cold open -> branch point cut
    [BEAT_BRANCH]: { next: VAR_TENSE, prefetch: [VAR_CALM] }, // branch -> tense (calm prefetched)
    [BEAT_TENSE]: { next: VAR_ENDING, prefetch: [VAR_ENDING_PREMIUM] }, // tense -> ending (premium prefetched)
    [BEAT_CALM]: { next: VAR_ENDING, prefetch: [VAR_ENDING_PREMIUM] },
    [BEAT_ENDING]: "end",
  };

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const rawBody = init?.body;
    let body: unknown;
    if (typeof rawBody === "string") {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }
    requests.push({
      url,
      method,
      hasAuthHeader: headers.has("authorization"),
      body,
    });

    // content: GET /series/{id}/graph (the NESTED shape the real service returns; the client flattens).
    if (url.includes(`/series/${SERIES_ID}/graph`)) {
      return json(200, nestedSeedGraph());
    }

    // economy: GET /wallet
    if (url.endsWith("/wallet")) {
      return json(200, {
        user_id: "server-derived-subject",
        balance,
        bonus_balance: 0,
        entitlements,
      });
    }

    // economy: POST /spend
    if (url.endsWith("/spend") && method === "POST") {
      const b = (body ?? {}) as { scope?: string; scope_id?: string; client_txn_id?: string };
      const txn = b.client_txn_id ?? "";
      if (seenTxns.has(txn)) {
        const prior = seenTxns.get(txn)!;
        return json(200, prior);
      }
      const cost = priceFor(b.scope_id);
      if (balance < cost) {
        return json(402, { error: "insufficient_funds", options: ["buy", "watch_ad", "subscribe"] });
      }
      balance -= cost;
      const entitlement = { scope: b.scope ?? "beat_variant", scope_id: b.scope_id ?? "" };
      entitlements.push(entitlement);
      const result = { balance, entitlement };
      seenTxns.set(txn, result);
      return json(200, result);
    }

    // decision: POST /decide
    if (url.endsWith("/decide") && method === "POST") {
      const b = (body ?? {}) as { current_beat_id?: string };
      const step = decideNext[b.current_beat_id ?? ""];
      if (!step || step === "end") {
        return json(422, { error: "no_successors" });
      }
      return json(200, {
        decision_id: "dddddddd-0000-0000-0000-000000000001",
        next_variant_id: step.next,
        prefetch_variant_ids: step.prefetch,
        is_control: false,
        policy_version: "mock-1",
      });
    }

    // manifest: GET /manifest/{id}.m3u8
    if (url.includes("/manifest/") && url.endsWith(".m3u8")) {
      return new Response("#EXTM3U\n#EXT-X-ENDLIST\n", {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      });
    }

    return json(404, { error: "not_found" });
  }) as typeof globalThis.fetch;

  function priceFor(scopeId: string | undefined): number {
    return scopeId === VAR_ENDING_PREMIUM ? 5 : 0;
  }

  return {
    fetch: fetchImpl,
    requests,
    bodies() {
      return requests
        .filter((r) => r.body && typeof r.body === "object")
        .map((r) => r.body as Record<string, unknown>);
    },
  };
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
