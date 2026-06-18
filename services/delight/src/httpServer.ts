// Production HTTP entry point for the DELIGHT service (prompts 25-D3 character inbox + 25-D4 branch-as-quest).
// Mirrors the adaptation/ingestion shape: a node:http server bound to 0.0.0.0 on PORT (default 8107) so a
// container port map reaches it; the DELIGHT API handlers (api.ts) over an injected store + ports; a
// NODE_ENV=production cutover gate on the session verifier (the test verifier is refused in production, like
// decision/economy/adaptation). node:http only, no external server package, so no new runtime dependency.
//
// CORS: this is a CORS-OK service (the consumer app browser calls it with a bearer token). Per the project
// CORS pattern (services/identity, services/content): answer an OPTIONS preflight with 204 +
// access-control-allow-origin:* + allow-headers content-type,authorization,accept + allow-methods
// GET,POST,PATCH,DELETE,OPTIONS, and set access-control-allow-origin:* on EVERY response. No cookies.
//
// NOT DEPLOYED: this service is intentionally absent from render.yaml. It stays unwired until
// scripts/sql/13_delight.sql is applied, a real JWKS SessionVerifier + a PgDelightStore are wired, and the
// economy/decision/consent/c2pa ports point at real clients. NODE_ENV=production hard-stops on the test
// verifier (CUTOVER GATE in selectVerifier). No em dashes.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { handle, type ApiDeps, type ApiRequest } from "./api.js";
import { InMemoryDelightStore, type DelightStore } from "./store.js";
import {
  testSessionVerifier,
  testAgeGate,
  testEconomyDebit,
  testDecisionPlane,
  testConsentLedger,
  testC2paSigner,
  type SessionVerifier,
} from "./ports.js";

export interface DelightServerConfig {
  nodeEnv: string | undefined;
}

export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DelightServerConfig {
  return { nodeEnv: env.NODE_ENV };
}

// CUTOVER GATE: in production a real JWKS-backed verifier MUST be injected; the test verifier is refused
// here, exactly as services/adaptation selectVerifier does.
export function selectVerifier(cfg: DelightServerConfig): SessionVerifier {
  if (cfg.nodeEnv === "production") {
    throw new Error(
      "delight server: real JWKS verifier wiring is a cutover gate and is not implemented; " +
        "inject a real SessionVerifier before running with NODE_ENV=production",
    );
  }
  return testSessionVerifier();
}

export function selectStore(): DelightStore {
  return new InMemoryDelightStore();
}

// Default cool-down for the paid clue + spend path. Anti-dark-pattern: a real, modest spend cool-down.
const DEFAULT_CLUE_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_CLUE_PRICE = 5;

export function buildDeps(cfg: DelightServerConfig, overrides: Partial<ApiDeps> = {}): ApiDeps {
  return {
    store: overrides.store ?? selectStore(),
    verifier: overrides.verifier ?? selectVerifier(cfg),
    ageGate: overrides.ageGate ?? testAgeGate(),
    economy: overrides.economy ?? testEconomyDebit(),
    decision: overrides.decision ?? testDecisionPlane(),
    consent: overrides.consent ?? testConsentLedger(),
    c2pa: overrides.c2pa ?? testC2paSigner(),
    clueCooldownMs: overrides.clueCooldownMs ?? DEFAULT_CLUE_COOLDOWN_MS,
    cluePriceCredits: overrides.cluePriceCredits ?? DEFAULT_CLUE_PRICE,
    now: overrides.now ?? (() => Date.now()),
  };
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function toApiRequest(req: IncomingMessage, body: Buffer): ApiRequest {
  const host = req.headers.host ?? "delight.local";
  const url = new URL(req.url ?? "/", `http://${host}`);
  let parsed: unknown = undefined;
  if (body.length > 0) {
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      parsed = undefined;
    }
  }
  const auth = req.headers.authorization;
  return {
    method: req.method ?? "GET",
    path: url.pathname,
    authorization: Array.isArray(auth) ? (auth[0] ?? null) : (auth ?? null),
    body: parsed,
  };
}

// The permissive CORS headers set on every response (CORS-OK services pattern).
function setCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type,authorization,accept");
  res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
}

export function startServer(
  deps: ApiDeps,
  port = 0,
  host = "0.0.0.0",
): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        setCors(res);
        // OPTIONS preflight: 204, CORS headers already set, no body.
        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }
        const body = await readBody(req);
        const apiReq = toApiRequest(req, body);
        const apiRes = await handle(apiReq, deps);
        res.writeHead(apiRes.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(apiRes.body));
      } catch {
        if (!res.headersSent) {
          setCors(res);
          res.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        }
        res.end(JSON.stringify({ error: "internal_error" }));
      }
    })();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address() as AddressInfo;
      resolve({ server, port: address.port });
    });
  });
}

// Start the listener from the process environment. selectVerifier throws under NODE_ENV=production, so the
// CUTOVER GATE hard stop is preserved. Sets process.exitCode on failure (matches adaptation runServer).
export async function runServer(): Promise<void> {
  try {
    const cfg = readConfigFromEnv();
    const port = Number(process.env.PORT ?? 8107);
    const host = process.env.HOST ?? "0.0.0.0";
    const deps = buildDeps(cfg);
    const { port: bound } = await startServer(deps, port, host);
    // eslint-disable-next-line no-console
    console.log(`delight service listening on ${host}:${bound} (source: ${deps.store.wired ? "wired" : "unwired"})`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start delight server", err);
    process.exitCode = 1;
  }
}
