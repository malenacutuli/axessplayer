// P7-T2/T3 trust serve listener. Exposes the trust domain over HTTP: record C2PA provenance, append a
// consent row to the tamper-evident chain (P7-T1 write path), and verify a variant (the Article 50 /
// provenance tap-through: a DISCLOSURE of servability + provenance, not a per-decision explanation, C7).
// A variant is servable only when signed provenance exists and the consent chain is intact. No em dashes.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { TrustService } from "./trust.js";
import type { C2paClaim } from "./c2pa.js";
import type { ConsentInput } from "./trust.js";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, accept",
};

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...CORS });
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return (raw ? JSON.parse(raw) : {}) as T;
}

export function createTrustServer(trust: TrustService): Server {
  return createServer((req, res) => {
    void (async () => {
      try {
        const method = (req.method ?? "GET").toUpperCase();
        const path = (req.url ?? "/").split("?")[0];
        if (method === "OPTIONS") {
          res.writeHead(204, CORS);
          return res.end();
        }
        if (path === "/healthz") return send(res, 200, { ok: true });

        // Record a C2PA provenance claim (signed at serve with the test signer; KMS is the cutover).
        if (method === "POST" && path === "/provenance") {
          const claim = await readJson<C2paClaim>(req);
          const row = await trust.recordProvenance(claim);
          return send(res, 201, { credential: row });
        }

        // Append a consent row to the variant's hash chain (the consent write path).
        if (method === "POST" && path === "/consent") {
          const input = await readJson<ConsentInput>(req);
          const row = await trust.appendConsent(input);
          return send(res, 201, { consent: row });
        }

        // Article 50 / provenance tap-through: disclose whether the variant is servable and why.
        if (method === "GET" && path.startsWith("/verify/")) {
          const variantId = decodeURIComponent(path.replace("/verify/", ""));
          const result = await trust.verifyVariant(variantId);
          return send(res, 200, result);
        }
        send(res, 404, { error: "not found" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // A signature-verification refusal or an FK violation is a client error, not a server fault.
        const code = /did not verify|violat|invalid|unknown/i.test(msg) ? 400 : 500;
        if (!res.headersSent) send(res, code, { error: msg });
      }
    })();
  });
}
