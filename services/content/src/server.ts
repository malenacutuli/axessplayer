// Production HTTP entry point for the content service. The package EXPORTS createContentApp (a Hono app
// factory) but nothing listens on it. This wraps that factory in a real node:http server so the container
// serves, binding 0.0.0.0 so a container port map reaches it (a process bound to 127.0.0.1 only answers on
// the loopback inside the container). The factory and the content handlers below it are consumed UNCHANGED.
// node:http is used (not an external server package) so the bridge needs no new dependency. No em dashes.
//
// The content contract documents NO auth for authoring (see http/app.ts), so unlike economy/decision there
// is no token verifier here and no JWKS cutover gate. If auth is later added to content.yaml it mounts in
// the app factory, not here.
//
// Env vars read here (must match infra/ENV.md):
//   DATABASE_URL   secret. Postgres connection string for the node-postgres Pool backing PgContentDb.
//   PORT           public. TCP port the listener binds. Defaults to 8080 (matches the Dockerfile).
//   HOST           public. Interface to bind. Defaults to 0.0.0.0 for container reachability.
//   NODE_ENV       public. `production` in deployed images.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import type { Hono } from "hono";

import { createContentApp } from "./http/app.js";
import { PgContentDb } from "./pgContentDb.js";

export interface ContentServerConfig {
  databaseUrl: string;
}

// Read config from the environment. Throws on a missing DATABASE_URL: content reads and writes the content
// tables, so there is nothing to serve without the system of record.
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ContentServerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl.length === 0) {
    throw new Error("content server: DATABASE_URL is required");
  }
  return { databaseUrl };
}

// Build the production content app: a node-postgres-backed PgContentDb handed to the existing factory.
export function buildContentApp(pool: pg.Pool): Hono {
  return createContentApp({ db: new PgContentDb(pool) });
}

// --- node:http bridge: map a Node request to a Web Request, run the Hono app, write the Web Response back.
// Mirrors services/manifest/src/server.ts and tests/e2e/src/servers.ts. Forwards the body so the create*
// POSTs work over the wire.
function toWebRequest(req: IncomingMessage, body: Buffer): Request {
  const host = req.headers.host ?? "content.local";
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

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isMain) {
  const cfg = readConfigFromEnv();
  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? "0.0.0.0";
  const pool = new pg.Pool({ connectionString: cfg.databaseUrl });
  const app = buildContentApp(pool);
  startServer(app, port, host)
    .then(({ port: bound }) => {
      // eslint-disable-next-line no-console
      console.log(`content service listening on ${host}:${bound}`);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("failed to start content server", err);
      process.exitCode = 1;
    });
}
