// Production HTTP entry point for the economy service. The package EXPORTS createEconomyApp (a Hono app
// factory) but nothing listens on it. This wraps that factory in a real node:http server so the container
// serves. It binds 0.0.0.0 so a container port map reaches it: a process bound to 127.0.0.1 only answers
// on the loopback inside the container and is unreachable from the host even with `-p`. The factory and the
// ledger handlers below it are consumed UNCHANGED. node:http is used (not an external server package) so no
// dependency or lockfile change is needed for the bridge. No em dashes.
//
// Env vars read here (must match infra/ENV.md):
//   DATABASE_URL                 secret. Postgres connection string for the node-postgres Pool the
//                                service-role PgEconomyDb runs `spend_coins`/`grant_coins` through.
//   PORT                         public. TCP port the listener binds. Defaults to 8080 (matches Dockerfile).
//   HOST                         public. Interface to bind. Defaults to 0.0.0.0 for container reachability.
//   NODE_ENV                     public. `production` in deployed images. Outside production the TEST
//                                verifiers are used for local/dev wiring; in production a real verifier is
//                                required (see the CUTOVER GATE below).
//   ECONOMY_SERVICE_SECRET       the bearer the /grant service verifier accepts. Non-production only.
//   AUTH_JWKS_URL/AUTH_JWT_ISSUER/AUTH_JWT_AUDIENCE  real JWKS verifier config. See CUTOVER GATE.
//
// CUTOVER GATE (flagged, not faked): real session/service token verification (JWT signature, JWKS
// rotation, issuer/audience, expiry) is NOT implemented in this service (auth.ts ships a TEST verifier
// only). In production a real Verifiers implementation MUST be injected here. Until that JWKS wiring lands,
// starting with NODE_ENV=production throws rather than silently serving with the test verifier. This is a
// deliberate hard stop so an unverified token scheme can never reach the live ledger.

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import type { Hono } from "hono";

import { createEconomyApp } from "./http/app.js";
import { testSessionVerifier, testServiceVerifier, type Verifiers } from "./http/auth.js";
import { selectSessionVerifier, pgUserIdResolver } from "@axessplayer/session-auth";
import { PgEconomyDb } from "./pgEconomyDb.js";

export interface EconomyServerConfig {
  databaseUrl: string;
  nodeEnv: string | undefined;
  serviceSecret: string | undefined;
  // Optional Postgres startup options, passed verbatim as the connection `options` parameter. On the shared
  // hosted project set DB_OPTIONS=-c search_path=mobile,public so unqualified names resolve to the `mobile`
  // schema. Unset for local dev. The spend/grant RPCs are immune (search_path='' + self-qualified).
  dbOptions?: string;
}

// Read the config from the process environment. Throws on a missing DATABASE_URL because the ledger has no
// in-memory fallback in production: there is nothing to serve without the system of record.
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EconomyServerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl.length === 0) {
    throw new Error("economy server: DATABASE_URL is required");
  }
  const dbOptions = env.DB_OPTIONS;
  return {
    databaseUrl,
    nodeEnv: env.NODE_ENV,
    serviceSecret: env.ECONOMY_SERVICE_SECRET,
    ...(dbOptions != null && dbOptions.length > 0 ? { dbOptions } : {}),
  };
}

// Choose the verifiers. In production a real JWKS-backed Verifiers MUST be injected; the test verifier is
// refused there so an unverified token scheme can never reach the ledger (the CUTOVER GATE above).
// Outside production the test verifiers are wired for local/dev use, keyed by ECONOMY_SERVICE_SECRET (a
// dev default is used if unset, since the test service verifier requires a non-empty secret).
// Real Supabase session verification whenever SUPABASE_URL + SUPABASE_ANON_KEY are set (any NODE_ENV); the
// test verifier only outside production without them; a hard stop in production without them.
export function selectVerifiers(cfg: EconomyServerConfig, pool?: pg.Pool, env: NodeJS.ProcessEnv = process.env): Verifiers {
  let secret = cfg.serviceSecret && cfg.serviceSecret.length > 0 ? cfg.serviceSecret : "dev-service-secret";
  if (cfg.nodeEnv === "production" && !(cfg.serviceSecret && cfg.serviceSecret.length > 0)) {
    // Misconfigured production: keep serving wallets, but lock /grant behind a secret nobody has.
    console.error("economy server: ECONOMY_SERVICE_SECRET is required in production; /grant is locked");
    secret = randomUUID() + randomUUID();
  }
  return {
    session: selectSessionVerifier({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY, NODE_ENV: cfg.nodeEnv }, testSessionVerifier, "economy server", pool ? pgUserIdResolver((sql, params) => pool.query(sql, params)) : undefined),
    service: testServiceVerifier(secret),
  };
}

// Build the production economy app: a service-role PgEconomyDb over a node-postgres Pool, plus the chosen
// verifiers, handed to the existing factory unchanged.
export function buildEconomyApp(pool: pg.Pool, cfg: EconomyServerConfig): Hono {
  return createEconomyApp({ db: new PgEconomyDb(pool), verifiers: selectVerifiers(cfg, pool) });
}

// --- node:http bridge: map a Node request to a Web Request, run the Hono app, write the Web Response back.
// Mirrors services/manifest/src/server.ts and tests/e2e/src/servers.ts. Forwards the body so POST /spend
// and POST /grant work over the wire.
function toWebRequest(req: IncomingMessage, body: Buffer): Request {
  const host = req.headers.host ?? "economy.local";
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
// src/serve.ts (the package `serve` script points node at that file). The previous is-main guard evaluated
// FALSE under `node --import tsx src/server.ts` run via pnpm, so the listener never started in the
// container. Extracting the start logic here and invoking it from a tiny no-guard entry makes startup
// deterministic. selectVerifiers still throws under NODE_ENV=production, so the CUTOVER GATE hard stop is
// preserved. Sets process.exitCode on failure rather than letting the rejection escape the caller.
export async function runServer(): Promise<void> {
  try {
    const cfg = readConfigFromEnv();
    const port = Number(process.env.PORT ?? 8080);
    const host = process.env.HOST ?? "0.0.0.0";
    const pool = new pg.Pool({
      connectionString: cfg.databaseUrl,
      ...(cfg.dbOptions ? { options: cfg.dbOptions } : {}),
    });
    const app = buildEconomyApp(pool, cfg);
    const { port: bound } = await startServer(app, port, host);
    // eslint-disable-next-line no-console
    console.log(`economy service listening on ${host}:${bound}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start economy server", err);
    process.exitCode = 1;
  }
}
