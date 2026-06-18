// Production HTTP entry point for the ingestion service (the content factory executor). Mirrors the
// content/decision shape: a node:http server bound to 0.0.0.0 on PORT (default 8103) so a container port
// map reaches it; the JOB API CONTRACT handlers (jobApi.ts) over an injected JobsStore + session verifier;
// a NODE_ENV=production cutover gate on the auth verifier (the test verifier is refused in production, like
// decision/economy). node:http only, no external server package, so no new dependency. NOT deployed: this
// service is intentionally absent from render.yaml until the produce_jobs table is applied and a real JWKS
// verifier + the real auto-produce orchestrator are wired. No em dashes.
//
// Env vars:
//   PORT       public. TCP port the listener binds. Defaults to 8103.
//   HOST       public. Interface to bind. Defaults to 0.0.0.0 for container reachability.
//   NODE_ENV   public. `production` hard-stops on the test verifier (CUTOVER GATE), like decision/economy.
//
// CUTOVER GATES (flagged, not faked):
//   1. AUTH / JWKS: real session verification is not implemented; the test verifier ships. production refuses it.
//   2. JOBS TABLE: mobile.produce_jobs (scripts/sql/08_produce_jobs.sql) is queued, NOT applied. The default
//      store is UnwiredJobsStore, so GET /jobs is empty + source:"unwired" and nothing is persisted.
//   3. EXECUTOR: the stage executor is the unwired stub; the real auto-produce factory / media-server
//      orchestrator is not connected, so no completed asset is ever fabricated.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { handle, testSessionVerifier, type ApiDeps, type ApiRequest, type SessionVerifier } from "./jobApi.js";
import { UnwiredJobsStore, RealProduceStore, type JobsStore } from "./jobsStore.js";
import { readRuntimeConfig } from "./produceRuntime.js";
import { makeProductionRunner } from "./produceRunner.js";

export interface IngestionServerConfig {
  nodeEnv: string | undefined;
}

export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): IngestionServerConfig {
  return { nodeEnv: env.NODE_ENV };
}

// Choose the verifier. In production a real JWKS-backed verifier MUST be injected; the test verifier is
// refused there (CUTOVER GATE 1), exactly as services/decision selectVerifiers does. Outside production the
// test verifier is wired for local/dev use.
export function selectVerifier(cfg: IngestionServerConfig): SessionVerifier {
  if (cfg.nodeEnv === "production") {
    throw new Error(
      "ingestion server: real JWKS verifier wiring is a cutover gate and is not implemented; " +
        "inject a real SessionVerifier before running with NODE_ENV=production"
    );
  }
  return testSessionVerifier();
}

// Choose the store. When the produce runtime is configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY +
// CONTENT_BASE_URL set), POST /produce runs a REAL accessibility-factory job over the live edge functions
// (RealProduceStore). Without those env vars the service stays in the unwired preview mode (cost-before-
// commit only), which is the safe default for a deploy that has not yet had the service-role key configured.
// Durable cross-process persistence remains the mobile.produce_jobs cutover (CUTOVER GATE 2).
export function selectStore(env: NodeJS.ProcessEnv = process.env): JobsStore {
  const cfg = readRuntimeConfig(env);
  if ("error" in cfg) return new UnwiredJobsStore();
  return new RealProduceStore(makeProductionRunner(cfg));
}

export function buildDeps(cfg: IngestionServerConfig): ApiDeps {
  return { store: selectStore(), verifier: selectVerifier(cfg) };
}

// Permissive CORS so the Vercel preview browsers can call this service cross-origin with a bearer token.
// Mirrors the identity/content services: ACAO:* on every response, preflight answered 204. No cookies.
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, accept",
};

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Map a node request + raw body into the pure ApiRequest. JSON body is parsed; a malformed body becomes
// undefined so the handler answers a clean 400 rather than throwing.
function toApiRequest(req: IncomingMessage, body: Buffer): ApiRequest {
  const host = req.headers.host ?? "ingestion.local";
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

// Bind the JOB API to a real node:http server. host defaults to 0.0.0.0 for container reachability; port 0
// picks an ephemeral port (tests). Resolves with the server and bound port.
export function startServer(
  deps: ApiDeps,
  port = 0,
  host = "0.0.0.0"
): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        // CORS preflight: answer 204 with the ACAO headers before any routing/auth.
        if ((req.method ?? "GET").toUpperCase() === "OPTIONS") {
          res.writeHead(204, CORS_HEADERS);
          res.end();
          return;
        }
        const body = await readBody(req);
        const apiReq = toApiRequest(req, body);
        const apiRes = await handle(apiReq, deps);
        res.writeHead(apiRes.status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          ...CORS_HEADERS,
        });
        res.end(JSON.stringify(apiRes.body));
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            ...CORS_HEADERS,
          });
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
// CUTOVER GATE hard stop is preserved. Sets process.exitCode on failure rather than letting the rejection
// escape the caller (matches content/decision runServer).
export async function runServer(): Promise<void> {
  try {
    const cfg = readConfigFromEnv();
    const port = Number(process.env.PORT ?? 8103);
    const host = process.env.HOST ?? "0.0.0.0";
    const deps = buildDeps(cfg);
    const { port: bound } = await startServer(deps, port, host);
    // eslint-disable-next-line no-console
    console.log(`ingestion service listening on ${host}:${bound} (source: ${deps.store.wired ? "wired" : "unwired"})`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start ingestion server", err);
    process.exitCode = 1;
  }
}
