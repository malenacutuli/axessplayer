// A real, listening node:http test server for the integration test: it implements the four contract
// endpoints the app touches (GET /wallet, POST /spend, GET /series/{id}/graph, POST /decide, GET
// /manifest/{id}.m3u8) with just enough behavior to drive the unlock flow end to end over a real socket
// (not in-process handler calls). It RECORDS every request body it receives so the test can assert F1: no
// user_id is ever sent in any body across the whole flow.
//
// This is the app lane's own mock (it does NOT import the services' code, which is read-only and out of
// lane). It mirrors the contract shapes from contracts/api/*.yaml. No em dashes.

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  COLD_OPEN_BEAT,
  PREMIUM_VARIANT,
  SERIES_ID,
  sampleSeriesGraph,
} from "../test-support/fixtures.js";

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
}

export interface TestServer {
  baseUrl: string;
  // Every request the server received, in order. The F1 assertion walks the bodies of these.
  requests: RecordedRequest[];
  // Test helper: add coins to the session subject's balance, simulating a verified grant from an ad/IAP
  // callback (which is server-to-server in the real economy, never a client call). Lets the test drive
  // the 402-then-200 unlock path.
  fund: (coins: number) => void;
  stop: () => Promise<void>;
}

// Behavior knobs: start the wallet broke so the first /spend 402s, then "fund" it so a retry 200s. This
// exercises the 402 PaywallOptions path AND the successful unlock in one flow.
export interface TestServerOptions {
  // Coins the session subject starts with. Default 0 (first spend hits the paywall).
  startingBalance?: number;
  // The price the server derives for the premium variant. Default 50.
  premiumPrice?: number;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function startTestServer(opts: TestServerOptions = {}): Promise<TestServer> {
  const requests: RecordedRequest[] = [];
  let balance = opts.startingBalance ?? 0;
  const price = opts.premiumPrice ?? 50;
  const entitlements: { scope: string; scope_id: string }[] = [];

  const server: Server = createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req);
      let body: unknown = undefined;
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      const url = new URL(req.url ?? "/", "http://test.local");
      requests.push({
        method: req.method ?? "GET",
        path: url.pathname,
        authorization: req.headers.authorization,
        body,
      });

      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      // Every contract endpoint here is session-scoped: require a bearer (401 otherwise), mirroring
      // economy 0.3.2. The decision contract also gets a bearer via the app's bearerFetch wrapper.
      if (!req.headers.authorization) return json(401, { error: "unauthorized" });

      // GET /wallet
      if (req.method === "GET" && url.pathname === "/wallet") {
        return json(200, {
          user_id: "99999999-9999-9999-9999-999999999999",
          balance,
          bonus_balance: 0,
          entitlements,
        });
      }

      // POST /spend (server-derived price; 402 when broke, 200 + entitlement otherwise; idempotent-ish)
      if (req.method === "POST" && url.pathname === "/spend") {
        const b = (body ?? {}) as { scope?: string; scope_id?: string };
        const already = entitlements.some((e) => e.scope_id === b.scope_id);
        if (already) return json(200, { balance, entitlement: { scope: b.scope, scope_id: b.scope_id } });
        if (balance < price) {
          return json(402, { error: "insufficient_funds", options: ["buy", "watch_ad", "subscribe"] });
        }
        balance -= price;
        const entitlement = { scope: b.scope ?? "beat_variant", scope_id: b.scope_id ?? PREMIUM_VARIANT };
        entitlements.push(entitlement);
        return json(200, { balance, entitlement });
      }

      // GET /series/{id}/graph
      if (req.method === "GET" && url.pathname === `/series/${SERIES_ID}/graph`) {
        return json(200, sampleSeriesGraph());
      }

      // POST /decide (decision contract; returns a chosen next variant + the cold-open branch)
      if (req.method === "POST" && url.pathname === "/decide") {
        return json(200, {
          decision_id: "55555555-5555-5555-5555-555555555555",
          next_variant_id: COLD_OPEN_BEAT,
          prefetch_variant_ids: [],
          is_control: false,
          policy_version: "test-1",
        });
      }

      // GET /manifest/{id}.m3u8
      if (req.method === "GET" && /^\/manifest\/.+\.m3u8$/.test(url.pathname)) {
        res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
        return res.end("#EXTM3U\n#EXT-X-ENDLIST\n");
      }

      return json(404, { error: "not_found" });
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    fund: (coins: number) => {
      balance += coins;
    },
    stop: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
