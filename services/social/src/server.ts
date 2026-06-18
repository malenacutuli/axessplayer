// Production HTTP entry point for the social service. The package EXPORTS createSocialApp (a Hono app
// factory); this wraps it in a real node:http server so the container serves, binding 0.0.0.0 so a
// container port map reaches it. Mirrors services/identity/src/server.ts and services/content. node:http is
// used (not an external server package) so the bridge needs no new dependency. No em dashes.
//
// Env vars read here (must match infra/ENV.md):
//   DATABASE_URL   secret. Postgres connection string for the node-postgres Pool backing PgSocialDb.
//   DB_OPTIONS     public. e.g. "-c search_path=mobile,public" so unqualified names resolve to `mobile`.
//   PORT           public. TCP port the listener binds. Defaults to 8108 (matches the Dockerfile).
//   HOST           public. Interface to bind. Defaults to 0.0.0.0 for container reachability.
//   NODE_ENV       public. `production` in deployed images. Outside production the TEST verifiers are used.
//
// CUTOVER GATES (flagged, not faked):
//   1. SESSION VERIFIER: real session-token verification is NOT implemented in this cut. auth.ts ships a
//      TEST verifier only. Starting with NODE_ENV=production throws rather than serving with the test
//      verifier.
//   2. SCAN PROVIDER (the safety spine): NO real CSAM/illegal + harassment scanner is wired. The pipeline
//      runs with scanner = null, so EVERY UGC write stays 'pending_provider' and is NEVER published
//      (fail-closed). A real ScanProvider MUST be injected before UGC can publish. Refusing to default to
//      a clean verdict is the whole point; this is intentional, not a stub-that-fakes-success.
//   3. AGE PROVIDER: the FailClosedAgeProvider returns "unknown" (blocked from mature) for every viewer
//      until the identity-plane-backed provider is wired.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import type { Hono } from "hono";

import { createSocialApp } from "./http/app.js";
import { testVerifiers, type Verifiers } from "./http/auth.js";
import { PgSocialDb } from "./socialDb.js";
import { FailClosedAgeProvider } from "./ageProvider.js";
import { FixedWindowRateLimiter, type RateLimiter } from "./rateLimit.js";
import type { ScanProvider } from "./moderation.js";

export interface SocialServerConfig {
  databaseUrl: string;
  nodeEnv: string | undefined;
  dbOptions?: string;
}

// Read config from the environment. Throws on a missing DATABASE_URL.
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SocialServerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl.length === 0) {
    throw new Error("social server: DATABASE_URL is required");
  }
  const dbOptions = env.DB_OPTIONS;
  return {
    databaseUrl,
    nodeEnv: env.NODE_ENV,
    ...(dbOptions != null && dbOptions.length > 0 ? { dbOptions } : {}),
  };
}

// Choose the verifiers. In production a real SessionVerifier MUST be injected; the test verifier is refused
// there (CUTOVER GATE 1). Outside production the test verifier is wired for local/dev use.
export function selectVerifiers(cfg: SocialServerConfig): Verifiers {
  if (cfg.nodeEnv === "production") {
    throw new Error(
      "social server: real session verifier wiring is a cutover gate and is not implemented; " +
        "inject a real SessionVerifier before running with NODE_ENV=production",
    );
  }
  return testVerifiers();
}

// CUTOVER GATE 2: the scan provider. There is NO real CSAM/illegal + harassment scanner in this cut, so we
// return null. With a null scanner the moderation pipeline keeps every UGC write 'pending_provider'
// (unpublished, fail-closed). A real ScanProvider MUST be injected before UGC can publish.
export function selectScanProvider(): ScanProvider | null {
  return null;
}

// A conservative default rate limit: 10 UGC writes per minute per (user, action). Production may swap a
// shared-store limiter.
export function selectRateLimiter(): RateLimiter {
  return new FixedWindowRateLimiter({ limit: 10, windowMs: 60_000 });
}

// Build the production social app: PgSocialDb over the pool, the (null) scanner, the fail-closed age
// provider, the rate limiter, and the chosen verifiers, handed to the existing factory unchanged.
export function buildSocialApp(pool: pg.Pool, cfg: SocialServerConfig): Hono {
  return createSocialApp({
    db: new PgSocialDb(pool),
    scanner: selectScanProvider(),
    age: new FailClosedAgeProvider(),
    rateLimiter: selectRateLimiter(),
    verifiers: selectVerifiers(cfg),
  }) as unknown as Hono;
}

// --- node:http bridge. Mirrors services/identity/src/server.ts and services/content.
function toWebRequest(req: IncomingMessage, body: Buffer): Request {
  const host = req.headers.host ?? "social.local";
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
// preserved.
export async function runServer(): Promise<void> {
  try {
    const cfg = readConfigFromEnv();
    const port = Number(process.env.PORT ?? 8108);
    const host = process.env.HOST ?? "0.0.0.0";
    const pool = new pg.Pool({
      connectionString: cfg.databaseUrl,
      ...(cfg.dbOptions ? { options: cfg.dbOptions } : {}),
    });
    const app = buildSocialApp(pool, cfg);
    const { port: bound } = await startServer(app, port, host);
    // eslint-disable-next-line no-console
    console.log(`social service listening on ${host}:${bound}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start social server", err);
    process.exitCode = 1;
  }
}
