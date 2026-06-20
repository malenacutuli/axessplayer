// Production HTTP entry for the generation engine. Wraps createGenerationApp in a node:http server (mirrors
// services/recap/src/server.ts), binding 0.0.0.0 for container reachability. node:http is used so the bridge
// needs no new dependency.
//
// WIRING (default is QA-safe, NOT real spend):
//   - EngineDb: PgEngineDb when DATABASE_URL is set, else InMemoryEngineDb (unwired preview).
//   - ProviderClient: a deterministic FakeProviderClient by default (no real spend). A REAL provider client
//     wraps the Supabase edge functions and only activates with GENERATION_REAL_BACKEND=1 + the edge env;
//     even then /generate is refused unless GENERATION_ALLOW_REAL_SPEND=1 (the human cost gate).
//   - ConsistencyScorer: a real edge-function scorer when wired, else a passing preview scorer.
//   - ConsentGate: an HTTP gate to services/trust when TRUST_BASE_URL is set, else an in-memory gate.
//
// Env: DATABASE_URL, DB_OPTIONS (-c search_path=mobile,public on hosted), PORT (default 8107), HOST,
// GENERATION_REAL_BACKEND, GENERATION_ALLOW_REAL_SPEND, GENERATION_MAX_BUDGET_USD, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, TRUST_BASE_URL. No em dashes.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import type { Hono } from "hono";

import { createGenerationApp, type GenerationAppDeps } from "./http/app.js";
import { testVerifiers } from "./http/auth.js";
import { PgEngineDb, InMemoryEngineDb, type EngineDb } from "./engineDb.js";
import { InMemorySubGenerationCache, FakeProviderClient, defaultRegistry, type ProviderClient } from "./router.js";
import { ScriptedScorer, type ConsistencyScorer } from "./consistency.js";
import { InMemoryConsentGate, type ConsentGate } from "./consentGate.js";
import { makeEdgeProviderClient, makeEdgeScorer, makeTrustConsentGate, readEdgeConfig } from "./providerClient.js";

export function buildGenerationApp(env: NodeJS.ProcessEnv = process.env): Hono {
  const databaseUrl = env.DATABASE_URL;
  let db: EngineDb;
  let source: "wired" | "unwired";
  if (databaseUrl && databaseUrl.length > 0) {
    const pool = new pg.Pool({ connectionString: databaseUrl, ...(env.DB_OPTIONS ? { options: env.DB_OPTIONS } : {}) });
    db = new PgEngineDb(pool);
    source = "wired";
  } else {
    db = new InMemoryEngineDb();
    source = "unwired";
  }

  const edge = readEdgeConfig(env);
  const useReal = env.GENERATION_REAL_BACKEND === "1" && edge != null;

  let client: ProviderClient;
  let scorer: ConsistencyScorer;
  let consent: ConsentGate;
  let realBackend: boolean;
  if (useReal && edge) {
    client = makeEdgeProviderClient(edge);
    scorer = makeEdgeScorer(edge);
    realBackend = true;
  } else {
    client = new FakeProviderClient(1);
    // A passing preview scorer for the QA path (no real embedding model). Clearly a stub: source != wired-real.
    scorer = new ScriptedScorer([{ faceCosine: 0.85, sceneScore: 0.85 }]);
    realBackend = false;
  }
  consent = env.TRUST_BASE_URL ? makeTrustConsentGate(env.TRUST_BASE_URL) : new InMemoryConsentGate();

  const deps: GenerationAppDeps = {
    db,
    registry: defaultRegistry(),
    client,
    scorer,
    consent,
    verifiers: testVerifiers(),
    realBackend,
    allowRealSpend: env.GENERATION_ALLOW_REAL_SPEND === "1",
    maxBudgetUsd: Number(env.GENERATION_MAX_BUDGET_USD ?? "25"),
    source: realBackend ? "wired" : source,
    cache: new InMemorySubGenerationCache(),
  };
  return createGenerationApp(deps);
}

// --- node:http bridge (mirrors services/recap/src/server.ts) ---
function toWebRequest(req: IncomingMessage, body: Buffer): Request {
  const host = req.headers.host ?? "generation.local";
  const url = `http://${host}${req.url ?? "/"}`;
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD" && body.length > 0) {
    init.body = new Uint8Array(body.buffer, body.byteOffset, body.byteLength) as unknown as BodyInit;
  }
  return new Request(url, init);
}

async function writeWebResponse(res: ServerResponse, webRes: Response): Promise<void> {
  const headers: Record<string, string> = {};
  webRes.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(webRes.status, headers);
  res.end(Buffer.from(await webRes.arrayBuffer()));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function startServer(app: Hono, port = 0, host = "0.0.0.0"): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const body = await readBody(req);
        const webRes = await app.fetch(toWebRequest(req, body));
        await writeWebResponse(res, webRes);
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

export async function runServer(): Promise<void> {
  try {
    const port = Number(process.env.PORT ?? 8107);
    const host = process.env.HOST ?? "0.0.0.0";
    const app = buildGenerationApp(process.env);
    const { port: bound } = await startServer(app, port, host);
    const real = process.env.GENERATION_REAL_BACKEND === "1";
    // eslint-disable-next-line no-console
    console.log(`generation service listening on ${host}:${bound} (backend: ${real ? "real" : "fake"})`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start generation server", err);
    process.exitCode = 1;
  }
}
