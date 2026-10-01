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

import { randomUUID } from "node:crypto";
import { createContentApp } from "./http/app.js";
import { PgContentDb } from "./pgContentDb.js";
import { PgReadingDb } from "./pgReadingDb.js";
import { makePosterGenerator } from "./poster.js";
import { sqlOwnership } from "./ownership.js";
import { sqlMediaStore } from "./mediaStore.js";
import { creatorOverview } from "./creatorStats.js";
import { sqlVideoStore } from "./videos.js";
import { createStreamApi, streamConfigFromEnv } from "./stream.js";
import { selectSessionVerifier, pgUserIdResolver, type SessionVerifier } from "@axessplayer/session-auth";

export interface ContentServerConfig {
  databaseUrl: string;
  // Optional Postgres startup options string, passed verbatim as the connection `options` parameter.
  // On the shared hosted project set DB_OPTIONS=-c search_path=mobile,public so unqualified table names
  // resolve to the isolated `mobile` schema. Unset for local dev (default `public` search path). The ledger
  // RPCs are immune either way (they hard-set search_path='' and self-qualify).
  dbOptions?: string;
}

// Read config from the environment. Throws on a missing DATABASE_URL: content reads and writes the content
// tables, so there is nothing to serve without the system of record.
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ContentServerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl == null || databaseUrl.length === 0) {
    throw new Error("content server: DATABASE_URL is required");
  }
  const dbOptions = env.DB_OPTIONS;
  return { databaseUrl, ...(dbOptions != null && dbOptions.length > 0 ? { dbOptions } : {}) };
}

// Build the production content app: a node-postgres-backed PgContentDb handed to the existing factory,
// plus an optional server-side poster generator wired from the Supabase env (SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY + POSTER_BUCKET, default the public "thumbnails" bucket). When the env is
// absent the generator is undefined and the generate route answers 501.
export function buildContentApp(pool: pg.Pool, env: NodeJS.ProcessEnv = process.env): Hono {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const posterGen =
    supabaseUrl && serviceKey
      ? makePosterGenerator({ supabaseUrl, serviceKey, bucket: env.POSTER_BUCKET ?? "thumbnails" })
      : undefined;
  // Events service base URL so the reader/watch pages emit engagement events into the demand sensor. Defaults
  // to the live events service; override with EVENTS_BASE_URL (empty string disables emission).
  const eventsBaseUrl = env.EVENTS_BASE_URL ?? "https://axessplayer-events.onrender.com";
  // Creator auth: real Supabase sessions (test verifier only outside production), series ownership over the
  // same pool, and a service secret for the /admin routes other services call. Production refuses to start
  // without the secret, so those routes are never open there.
  let serviceSecret = env.CONTENT_SERVICE_SECRET;
  if (env.NODE_ENV === "production" && !serviceSecret) {
    // Misconfigured production: keep serving, but lock the /admin routes behind a secret nobody has.
    console.error("content server: CONTENT_SERVICE_SECRET is required in production; /admin routes are locked");
    serviceSecret = randomUUID() + randomUUID();
  }
  const session: SessionVerifier = selectSessionVerifier(
    { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY, NODE_ENV: env.NODE_ENV },
    () => ({
      // Local stacks only: the same session:<uuid> scheme the other services' test verifiers use.
      verifySession: async (t) => {
        const m = /^session:([0-9a-f-]{36})$/i.exec(t ?? "");
        return m ? { userId: m[1] } : null;
      },
    }),
    "content server",
    pgUserIdResolver((sql, params) => pool.query(sql, params)),
  );
  const auth = {
    session,
    ownership: sqlOwnership((sql, params) => pool.query(sql, params)),
    ...(serviceSecret ? { serviceSecret } : {}),
  };
  // Media state + Cloudflare Stream (creator uploads, signed playback). Stream is on only when all of
  // CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_STREAM_API_TOKEN, STREAM_WEBHOOK_SECRET, STREAM_SIGNING_KEY_ID and
  // STREAM_SIGNING_KEY_PEM are set (scripts/stream-setup.mjs); otherwise the upload route answers 501.
  const media = sqlMediaStore((sql, params) => pool.query(sql, params));
  const streamCfg = streamConfigFromEnv(env);
  const stream = streamCfg ? createStreamApi(streamCfg) : undefined;
  return createContentApp({
    db: new PgContentDb(pool),
    reading: new PgReadingDb(pool),
    eventsBaseUrl,
    auth,
    media,
    creatorOverview: creatorOverview((sql, params) => pool.query(sql, params)),
    videos: sqlVideoStore((sql, params) => pool.query(sql, params)),
    ...(stream ? { stream } : {}),
    ...(posterGen ? { posterGen } : {}),
  });
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

// Start the listener from the process environment. Called UNCONDITIONALLY by the guard-free entry file
// src/serve.ts (the package `serve` script points node at that file). The previous is-main guard evaluated
// FALSE under `node --import tsx src/server.ts` run via pnpm, so the listener never started in the
// container. Extracting the start logic here and invoking it from a tiny no-guard entry makes startup
// deterministic. Sets process.exitCode on failure rather than letting the rejection escape the caller.
export async function runServer(): Promise<void> {
  try {
    const cfg = readConfigFromEnv();
    const port = Number(process.env.PORT ?? 8080);
    const host = process.env.HOST ?? "0.0.0.0";
    const pool = new pg.Pool({
      connectionString: cfg.databaseUrl,
      ...(cfg.dbOptions ? { options: cfg.dbOptions } : {}),
    });
    const app = buildContentApp(pool);
    const { port: bound } = await startServer(app, port, host);
    // eslint-disable-next-line no-console
    console.log(`content service listening on ${host}:${bound}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start content server", err);
    process.exitCode = 1;
  }
}
