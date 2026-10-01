// Production HTTP entry point for the identity service. The package EXPORTS createIdentityApp (a Hono app
// factory); this wraps it in a real node:http server so the container serves, binding 0.0.0.0 so a
// container port map reaches it (a process bound to 127.0.0.1 only answers on the loopback inside the
// container). Mirrors services/content/src/server.ts and services/decision/src/server.ts. node:http is
// used (not an external server package) so the bridge needs no new dependency. No em dashes.
//
// Env vars read here (must match infra/ENV.md):
//   DATABASE_URL   secret. Postgres connection string for the node-postgres Pool backing PgIdentityDb.
//   DB_OPTIONS     public. e.g. "-c search_path=mobile,public" so unqualified names resolve to `mobile`.
//   PORT           public. TCP port the listener binds. Defaults to 8097 (matches the Dockerfile).
//   HOST           public. Interface to bind. Defaults to 0.0.0.0 for container reachability.
//   NODE_ENV       public. `production` in deployed images. Outside production the TEST verifiers are used.
//   SUPABASE_JWT_SECRET / SUPABASE_URL  real Supabase Auth JWT verifier config. See CUTOVER GATE.
//
// CUTOVER GATE (flagged, not faked):
//   1. SUPABASE AUTH JWT: real access-token verification (HS256 via SUPABASE_JWT_SECRET, or JWKS derived
//      from SUPABASE_URL) is NOT implemented in this cut. auth.ts ships TEST verifiers only. In production
//      a real AuthTokenVerifier AND SessionVerifier MUST be injected here; starting with
//      NODE_ENV=production throws rather than silently serving with the test verifiers.
//   2. CONSENT LEDGER: POST /consent writes to an in-memory ConsentSink stub. The real wiring POSTs to
//      services/trust's append-only consent chain. No migration/SQL is written from this service.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import type { Hono } from "hono";

import { createIdentityApp } from "./http/app.js";
import { testSessionVerifier, testAuthTokenVerifier, type AuthTokenVerifier, type Verifiers } from "./http/auth.js";
import { selectSessionVerifier, pgUserIdResolver, supabaseAuthUserVerifier } from "@axessplayer/session-auth";
import { PgIdentityDb } from "./identityDb.js";
import { InMemoryConsentSink, type ConsentSink } from "./consent.js";

export interface IdentityServerConfig {
  databaseUrl: string;
  nodeEnv: string | undefined;
  // Optional Postgres startup options, passed verbatim as the connection `options` parameter. On the
  // shared hosted project set DB_OPTIONS=-c search_path=mobile,public. Unset for local dev (default public).
  dbOptions?: string;
}

// Read config from the environment. Throws on a missing DATABASE_URL: identity reads and writes the user
// system of record, so there is nothing to serve without it.
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): IdentityServerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl.length === 0) {
    throw new Error("identity server: DATABASE_URL is required");
  }
  const dbOptions = env.DB_OPTIONS;
  return {
    databaseUrl,
    nodeEnv: env.NODE_ENV,
    ...(dbOptions != null && dbOptions.length > 0 ? { dbOptions } : {}),
  };
}

// Choose the verifiers. In production a real Supabase-JWT-backed AuthTokenVerifier and a real
// SessionVerifier MUST be injected; the test verifiers are refused there (CUTOVER GATE 1). Outside
// production the test verifiers are wired for local/dev use.
// Profiles are keyed by email, so a Supabase login without one (phone-only) cannot be linked: reject it.
function emailRequired(v: ReturnType<typeof supabaseAuthUserVerifier>): AuthTokenVerifier {
  return {
    async verifyAccessToken(token) {
      const u = await v.verifyAccessToken(token);
      return u && u.email ? { authId: u.authId, email: u.email } : null;
    },
  };
}

// Real Supabase session verification whenever SUPABASE_URL + SUPABASE_ANON_KEY are set (any NODE_ENV); the
// test verifier only outside production without them; a hard stop in production without them.
export function selectVerifiers(cfg: IdentityServerConfig, pool?: pg.Pool, env: NodeJS.ProcessEnv = process.env): Verifiers {
  const real = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
  return {
    session: selectSessionVerifier({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY, NODE_ENV: cfg.nodeEnv }, testSessionVerifier, "identity server", pool ? pgUserIdResolver((sql, params) => pool.query(sql, params)) : undefined),
    // /auth/verify links a Supabase login to a profile, so it needs the verified Supabase subject itself.
    auth: real ? emailRequired(supabaseAuthUserVerifier({ supabaseUrl: env.SUPABASE_URL as string, anonKey: env.SUPABASE_ANON_KEY as string })) : testAuthTokenVerifier(),
  };
}

// The consent sink. CUTOVER GATE 2: the real wiring routes to services/trust's consent chain. This cut
// ships the in-memory stub.
export function selectConsentSink(): ConsentSink {
  return new InMemoryConsentSink();
}

// Build the production identity app: PgIdentityDb over the pool, the consent sink, and the chosen
// verifiers, handed to the existing factory unchanged.
export function buildIdentityApp(pool: pg.Pool, cfg: IdentityServerConfig): Hono {
  return createIdentityApp({
    db: new PgIdentityDb(pool),
    consent: selectConsentSink(),
    verifiers: selectVerifiers(cfg, pool),
  }) as unknown as Hono;
}

// --- node:http bridge: map a Node request to a Web Request, run the Hono app, write the Web Response back.
// Mirrors services/content/src/server.ts and services/decision/src/server.ts.
function toWebRequest(req: IncomingMessage, body: Buffer): Request {
  const host = req.headers.host ?? "identity.local";
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
// src/serve.ts. selectVerifiers still throws under NODE_ENV=production, so the CUTOVER GATE hard stop is
// preserved. Sets process.exitCode on failure rather than letting the rejection escape the caller.
export async function runServer(): Promise<void> {
  try {
    const cfg = readConfigFromEnv();
    const port = Number(process.env.PORT ?? 8097);
    const host = process.env.HOST ?? "0.0.0.0";
    const pool = new pg.Pool({
      connectionString: cfg.databaseUrl,
      ...(cfg.dbOptions ? { options: cfg.dbOptions } : {}),
    });
    const app = buildIdentityApp(pool, cfg);
    const { port: bound } = await startServer(app, port, host);
    // eslint-disable-next-line no-console
    console.log(`identity service listening on ${host}:${bound}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start identity server", err);
    process.exitCode = 1;
  }
}
