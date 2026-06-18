// Production HTTP entry point for the library service. The package EXPORTS createLibraryApp (a Hono app
// factory); this wraps it in a real node:http server so the container serves, binding 0.0.0.0 so a
// container port map reaches it (a process bound to 127.0.0.1 only answers on the loopback inside the
// container). The factory and the pure handlers below it are consumed UNCHANGED. node:http is used (not an
// external server package) so the bridge needs no new dependency. Mirrors services/decision/src/server.ts.
//
// This service is NEW and is NOT deployed: it is intentionally absent from render.yaml and the 5 live
// services. The shape matches content/decision so a future cutover is mechanical. No em dashes.
//
// Env vars read here:
//   DATABASE_URL   secret. Postgres connection string for the node-postgres Pool backing PgLibraryDb.
//   DB_OPTIONS     public. Passed verbatim as the connection `options`. On the shared hosted project set
//                  DB_OPTIONS=-c search_path=mobile,public so unqualified table names resolve to the
//                  isolated `mobile` schema (where saved/favorites/downloads/channel_follows live).
//   PORT           public. TCP port the listener binds. Defaults to 8101 (the library service port).
//   HOST           public. Interface to bind. Defaults to 0.0.0.0 for container reachability.
//   NODE_ENV       public. `production` in deployed images. Outside production the TEST session verifier is
//                  used for local/dev wiring; in production a real verifier is required (CUTOVER GATE).
//
// CUTOVER GATE (flagged, not faked): real session token verification is NOT implemented (auth.ts ships a
// TEST verifier only). In production a real Verifiers MUST be injected. Starting with NODE_ENV=production
// hard-throws rather than silently serving with the test verifier.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import type { Hono } from "hono";

import { createLibraryApp } from "./http/app.js";
import { testVerifiers, type Verifiers } from "./http/auth.js";
import { PgLibraryDb } from "./pgLibraryDb.js";

export interface LibraryServerConfig {
  databaseUrl: string;
  nodeEnv: string | undefined;
  dbOptions?: string;
}

// Read config from the environment. Throws on a missing DATABASE_URL: the service reads and writes the
// library tables, so there is nothing to serve without the system of record.
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LibraryServerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl.length === 0) {
    throw new Error("library server: DATABASE_URL is required");
  }
  const dbOptions = env.DB_OPTIONS;
  return {
    databaseUrl,
    nodeEnv: env.NODE_ENV,
    ...(dbOptions != null && dbOptions.length > 0 ? { dbOptions } : {}),
  };
}

// Choose the verifiers. In production a real JWKS-backed Verifiers MUST be injected; the test verifier is
// refused there (CUTOVER GATE). Outside production the test verifier is wired for local/dev use.
export function selectVerifiers(cfg: LibraryServerConfig): Verifiers {
  if (cfg.nodeEnv === "production") {
    throw new Error(
      "library server: real session verifier wiring is a cutover gate and is not implemented; " +
        "inject a real Verifiers before running with NODE_ENV=production"
    );
  }
  return testVerifiers();
}

// Build the production library app: a node-postgres-backed PgLibraryDb plus the chosen verifiers, handed
// to the existing factory unchanged.
export function buildLibraryApp(pool: pg.Pool, cfg: LibraryServerConfig): Hono {
  return createLibraryApp({ db: new PgLibraryDb(pool), verifiers: selectVerifiers(cfg) });
}

// --- node:http bridge: map a Node request to a Web Request, run the Hono app, write the Web Response back.
// Mirrors services/content/src/server.ts and services/decision/src/server.ts. Forwards the body so the
// POST/PATCH/DELETE-with-body routes work over the wire.
function toWebRequest(req: IncomingMessage, body: Buffer): Request {
  const host = req.headers.host ?? "library.local";
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
  host = "0.0.0.0"
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
// src/serve.ts. selectVerifiers throws under NODE_ENV=production, so the CUTOVER GATE hard stop is
// preserved. Sets process.exitCode on failure rather than letting the rejection escape the caller.
export async function runServer(): Promise<void> {
  try {
    const cfg = readConfigFromEnv();
    const port = Number(process.env.PORT ?? 8101);
    const host = process.env.HOST ?? "0.0.0.0";
    const pool = new pg.Pool({
      connectionString: cfg.databaseUrl,
      ...(cfg.dbOptions ? { options: cfg.dbOptions } : {}),
    });
    const app = buildLibraryApp(pool, cfg);
    const { port: bound } = await startServer(app, port, host);
    // eslint-disable-next-line no-console
    console.log(`library service listening on ${host}:${bound}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start library server", err);
    process.exitCode = 1;
  }
}
