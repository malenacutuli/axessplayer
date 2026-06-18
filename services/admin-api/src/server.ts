// Production HTTP entry for the admin API. Wraps the Hono app factory in a real node:http server bound to
// 0.0.0.0 so a container port map reaches it, mirroring services/content and services/decision. node:http
// is used (no external server dep). This service is NOT deployed and NOT in render.yaml; this file makes
// it runnable locally and in tests. No em dashes.
//
// Env vars (must match infra/ENV.md if this is ever deployed):
//   DATABASE_URL   secret. Postgres connection string for the node-postgres Pool. REQUIRED.
//   PORT           public. TCP port the listener binds. Defaults to 8102 (the slice B port).
//   HOST           public. Interface to bind. Defaults to 0.0.0.0 for container reachability.
//   NODE_ENV       public. `production` in deployed images. Under production the TEST operator verifier
//                  is REFUSED (cutover gate): a real MFA/JWKS-backed verifier must be injected.
//   DB_OPTIONS     public. Passed verbatim as the pg `options`. On the shared hosted project set
//                  `-c search_path=mobile,public` so unqualified names resolve to the `mobile` schema.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import type { Hono } from "hono";

import { createAdminApp, type AppDeps } from "./http/app.js";
import { testOperatorVerifier, type OperatorVerifier } from "./auth.js";
import { PgAuditSink, type AdminAuditSink } from "./audit.js";

export interface AdminServerConfig {
  databaseUrl: string;
  nodeEnv: string | undefined;
  dbOptions?: string;
}

// Read config from the environment. Throws on a missing DATABASE_URL: every endpoint aggregates the
// hosted schema, so there is nothing to serve without it.
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AdminServerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl.length === 0) {
    throw new Error("admin-api server: DATABASE_URL is required");
  }
  const dbOptions = env.DB_OPTIONS;
  return { databaseUrl, nodeEnv: env.NODE_ENV, ...(dbOptions != null && dbOptions.length > 0 ? { dbOptions } : {}) };
}

// Choose the operator verifier. CUTOVER GATE: in production a real MFA/JWKS-backed OperatorVerifier MUST
// be injected; the test verifier is refused there. Outside production the test verifier is wired for
// local/dev use.
export function selectVerifier(cfg: AdminServerConfig): OperatorVerifier {
  if (cfg.nodeEnv === "production") {
    throw new Error(
      "admin-api server: real operator MFA/JWKS verifier wiring is a cutover gate and is not implemented; " +
        "inject a real OperatorVerifier before running with NODE_ENV=production",
    );
  }
  return testOperatorVerifier();
}

// Build the production admin app: a node-postgres pool as the query port, the selected verifier, and the
// Pg-backed immutable audit sink. The cutover gate throws here under NODE_ENV=production.
export function buildAdminApp(pool: pg.Pool, cfg: AdminServerConfig, auditOverride?: AdminAuditSink): Hono {
  const verifier = selectVerifier(cfg);
  const audit: AdminAuditSink = auditOverride ?? new PgAuditSink(pool);
  const deps: AppDeps = { db: pool, verifier, audit };
  return createAdminApp(deps);
}

// --- node:http bridge (identical shape to content/decision). Maps a Node request to a Web Request, runs
// the Hono app, writes the Web Response back. Forwards the body so future POSTs work over the wire.
function toWebRequest(req: IncomingMessage, body: Buffer): Request {
  const host = req.headers.host ?? "admin-api.local";
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

// Start the listener from the process environment. Called UNCONDITIONALLY by the guard-free entry
// src/serve.ts. selectVerifier still throws under NODE_ENV=production, so the cutover gate hard stop is
// preserved. Sets process.exitCode on failure rather than letting the rejection escape the caller.
export async function runServer(): Promise<void> {
  try {
    const cfg = readConfigFromEnv();
    const port = Number(process.env.PORT ?? 8102);
    const host = process.env.HOST ?? "0.0.0.0";
    const pool = new pg.Pool({
      connectionString: cfg.databaseUrl,
      ...(cfg.dbOptions ? { options: cfg.dbOptions } : {}),
    });
    const app = buildAdminApp(pool, cfg);
    const { port: bound } = await startServer(app, port, host);
    // eslint-disable-next-line no-console
    console.log(`admin-api service listening on ${host}:${bound}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start admin-api server", err);
    process.exitCode = 1;
  }
}
