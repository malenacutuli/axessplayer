// Production HTTP entry point for the adaptation service (AI live-action adaptation, prompt 23). Mirrors
// the ingestion/content/decision shape: a node:http server bound to 0.0.0.0 on PORT (default 8105) so a
// container port map reaches it; the ADAPTATION API handlers (api.ts) over an injected store + adapter
// registry + analyze backend + session verifier; a NODE_ENV=production cutover gate on the auth verifier
// (the test verifier is refused in production, like decision/economy/ingestion). node:http only, no
// external server package, so no new dependency. NOT deployed: this service is intentionally absent from
// render.yaml until mobile.adaptation_* (scripts/sql/11_adaptation.sql) is applied and a real JWKS
// verifier + a PgAdaptationStore + real probe/render backends are wired. No em dashes.
//
// Env vars:
//   PORT       public. TCP port the listener binds. Defaults to 8105.
//   HOST       public. Interface to bind. Defaults to 0.0.0.0 for container reachability.
//   NODE_ENV   public. `production` hard-stops on the test verifier (CUTOVER GATE), like decision/economy.
//
// CUTOVER GATES (flagged, not faked):
//   1. AUTH / JWKS  : real session verification is not implemented; the test verifier ships, production refuses it.
//   2. SCHEMA       : mobile.adaptation_* is queued, NOT applied. The default store is InMemoryStore, so
//                     nothing is persisted and every payload carries source:"unwired".
//   3. ADAPTERS     : Tier A adapters apply constrained edits; Tier B/C adapters are gated stubs with no
//                     generative backend, so no completed asset is ever fabricated.
//   4. CONSENT      : the consent ledger is owned by services/trust; here a stub answers checkCurrent.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { handle, testSessionVerifier, type ApiDeps, type ApiRequest, type SessionVerifier } from "./api.js";
import { InMemoryStore, type AdaptationStore } from "./store.js";
import { defaultRegistry, type AdapterRegistry } from "./adapters.js";
import { fakeBackend, type AnalyzeBackend } from "./analyze.js";
import type { ConsentLedger } from "./rightsGate.js";

export interface AdaptationServerConfig {
  nodeEnv: string | undefined;
}

export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AdaptationServerConfig {
  return { nodeEnv: env.NODE_ENV };
}

// Choose the verifier. In production a real JWKS-backed verifier MUST be injected; the test verifier is
// refused there (CUTOVER GATE 1), exactly as services/ingestion selectVerifier does.
export function selectVerifier(cfg: AdaptationServerConfig): SessionVerifier {
  if (cfg.nodeEnv === "production") {
    throw new Error(
      "adaptation server: real JWKS verifier wiring is a cutover gate and is not implemented; " +
        "inject a real SessionVerifier before running with NODE_ENV=production",
    );
  }
  return testSessionVerifier();
}

// The consent ledger stub. Production injects a services/trust-backed client; the stub treats any
// consent_ref starting with "consent-revoked:" as revoked, everything else as current, so the gate path
// is exercisable offline. NEVER imports the live trust service.
export function stubConsentLedger(): ConsentLedger {
  return {
    async checkCurrent(consentRef) {
      return !consentRef.startsWith("consent-revoked:");
    },
  };
}

export function selectStore(): AdaptationStore {
  return new InMemoryStore();
}
export function selectRegistry(): AdapterRegistry {
  return defaultRegistry();
}
export function selectBackend(): AnalyzeBackend {
  return fakeBackend();
}

export function buildDeps(cfg: AdaptationServerConfig): ApiDeps {
  return {
    store: selectStore(),
    registry: selectRegistry(),
    backend: selectBackend(),
    verifier: selectVerifier(cfg),
    consent: stubConsentLedger(),
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
  const host = req.headers.host ?? "adaptation.local";
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

export function startServer(
  deps: ApiDeps,
  port = 0,
  host = "0.0.0.0",
): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const body = await readBody(req);
        const apiReq = toApiRequest(req, body);
        const apiRes = await handle(apiReq, deps);
        res.writeHead(apiRes.status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(apiRes.body));
      } catch {
        if (!res.headersSent) {
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
// CUTOVER GATE hard stop is preserved. Sets process.exitCode on failure (matches ingestion runServer).
export async function runServer(): Promise<void> {
  try {
    const cfg = readConfigFromEnv();
    const port = Number(process.env.PORT ?? 8105);
    const host = process.env.HOST ?? "0.0.0.0";
    const deps = buildDeps(cfg);
    const { port: bound } = await startServer(deps, port, host);
    // eslint-disable-next-line no-console
    console.log(`adaptation service listening on ${host}:${bound} (source: ${deps.store.wired ? "wired" : "unwired"})`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start adaptation server", err);
    process.exitCode = 1;
  }
}
