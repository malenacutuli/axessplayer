// Production HTTP entry point for the recap service. createRecapApp is a Hono app factory; this wraps it in
// a real node:http server so the container serves, binding 0.0.0.0 so a container port map reaches it.
// node:http is used (not an external server package) so the bridge needs no new dependency. The node:http
// bridge mirrors services/content/src/server.ts. No em dashes.
//
// Env vars read here (must match infra/ENV.md):
//   DATABASE_URL   secret. Postgres connection string for the node-postgres Pool backing PgRecapStore.
//   DB_OPTIONS     public. On the shared hosted project set -c search_path=mobile,public so unqualified
//                  table names resolve to the isolated mobile schema.
//   PORT           public. TCP port the listener binds. Defaults to 8096.
//   HOST           public. Interface to bind. Defaults to 0.0.0.0 for container reachability.
//   NODE_ENV       public. `production` in deployed images.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import type { Hono } from "hono";

import { createRecapApp } from "./http/app.js";
import { testVerifiers } from "./http/auth.js";
import { PgRecapStore } from "./store.js";
import { ConsoleEventSink } from "./events.js";

export interface RecapServerConfig {
  databaseUrl: string;
  // Optional Postgres startup options string, passed verbatim as the connection `options` parameter. On the
  // shared hosted project set DB_OPTIONS=-c search_path=mobile,public. Unset for local dev (default public).
  dbOptions?: string;
}

// Read config from the environment. Throws on a missing DATABASE_URL: recap reads viewer_state and beat
// variants, so there is nothing to serve without the system of record.
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RecapServerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl.length === 0) {
    throw new Error("recap server: DATABASE_URL is required");
  }
  const dbOptions = env.DB_OPTIONS;
  return { databaseUrl, ...(dbOptions != null && dbOptions.length > 0 ? { dbOptions } : {}) };
}

// Build the production recap app: a node-postgres-backed PgRecapStore + a console event sink (TODO: swap
// for a collector/DB sink, see events.ts) + the TEST session verifier. A production deployment MUST inject
// a real session verifier in place of testVerifiers(); the verifier interface is the contract, the test
// verifier is the flagged stub (mirrors decision/economy).
export function buildRecapApp(pool: pg.Pool): Hono {
  return createRecapApp({
    store: new PgRecapStore(pool),
    events: new ConsoleEventSink(),
    verifiers: testVerifiers(),
  });
}

// --- node:http bridge: map a Node request to a Web Request, run the Hono app, write the Web Response back.
// Mirrors services/content/src/server.ts.
function toWebRequest(req: IncomingMessage, body: Buffer): Request {
  const host = req.headers.host ?? "recap.local";
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

// Bind a Hono app to a real node:http server. host defaults to 0.0.0.0 for container reachability; port 0
// picks an ephemeral port (tests). Resolves with the server and bound port.
export function startServer(
  app: Hono,
  port = 0,
  host = "0.0.0.0",
): Promise<{ server: Server; port: number }> {
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

// Start the listener from the process environment. Called UNCONDITIONALLY by the guard-free entry file
// src/serve.ts. Binds PORT (default 8096) on HOST (default 0.0.0.0).
export async function runServer(): Promise<void> {
  try {
    const cfg = readConfigFromEnv();
    const port = Number(process.env.PORT ?? 8096);
    const host = process.env.HOST ?? "0.0.0.0";
    const pool = new pg.Pool({
      connectionString: cfg.databaseUrl,
      ...(cfg.dbOptions ? { options: cfg.dbOptions } : {}),
    });
    const app = buildRecapApp(pool);
    const { port: bound } = await startServer(app, port, host);
    // eslint-disable-next-line no-console
    console.log(`recap service listening on ${host}:${bound}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start recap server", err);
    process.exitCode = 1;
  }
}
