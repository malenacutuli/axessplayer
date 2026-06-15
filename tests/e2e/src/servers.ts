// Stand up the four REAL listening HTTP servers for the acceptance gate, each on an ephemeral localhost
// port, and drive them with a real fetch client over the network (NOT in-process handler calls).
//
//   economy  : serve createEconomyApp(...).fetch    on a node:http server (Hono Request/Response bridge).
//   decision : serve createDecisionApp(...).fetch    the same way.
//   content  : serve createContentApp(...).fetch     the same way.
//   manifest : use services/manifest/src/server.ts startServer(db) directly.
//
// The node:http bridge mirrors services/manifest/src/server.ts: it maps a Node IncomingMessage to a Web
// Request, hands it to the Hono app's .fetch, and writes the Web Response back. Unlike the manifest
// (GET-only) bridge, this one forwards the request body so POST /decide and POST /spend work over the
// wire. No new network dependency is added. No em dashes.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type pg from "pg";

import type { Hono } from "hono";

// --- the services under test, consumed READ-ONLY through their real public surfaces ---
import { createEconomyApp } from "../../../services/economy/src/http/app.js";
import { testVerifiers as economyTestVerifiers } from "../../../services/economy/src/http/auth.js";
import { PgEconomyDb } from "../../../services/economy/src/pgEconomyDb.js";

import { createDecisionApp } from "../../../services/decision/src/http/app.js";
import { testVerifiers as decisionTestVerifiers } from "../../../services/decision/src/http/auth.js";

import { createContentApp } from "../../../services/content/src/http/app.js";
import { PgContentDb } from "../../../services/content/src/pgContentDb.js";

import { startServer as startManifestServer } from "../../../services/manifest/src/server.js";

import { makeDecisionDeps } from "./decisionWiring.js";
import { PgManifestDb } from "./manifestWiring.js";

export interface RunningServer {
  baseUrl: string;
  server: Server;
  stop: () => Promise<void>;
}

// The fixed service-role secret the economy test verifier accepts. The acceptance harness sends this as
// the bearer on /grant; /wallet and /spend use the session scheme "session:<uuid>".
export const SERVICE_SECRET = "w12-acceptance-service-secret";

// Map a Node request into a Web Request, forwarding method, url, headers, and (for non-GET/HEAD) the body.
function toWebRequest(req: IncomingMessage, body: Buffer): Request {
  const host = req.headers.host ?? "service.local";
  const url = `http://${host}${req.url ?? "/"}`;
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD" && body.length > 0) {
    // A byte view is a valid runtime BodyInit; the cast bridges the DOM/Node lib typing gap.
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
  const buf = Buffer.from(await webRes.arrayBuffer());
  res.end(buf);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Bind a Hono app to a real node:http server on an ephemeral port. Returns the bound base url so callers
// issue real fetch() requests against it. This is the network boundary: every call crosses a socket.
function serveHono(app: Hono): Promise<RunningServer> {
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
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        server,
        stop: () =>
          new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
      });
    });
  });
}

export interface Services {
  economy: RunningServer;
  decision: RunningServer;
  content: RunningServer;
  manifest: RunningServer;
  stopAll: () => Promise<void>;
}

// Stand up all four services against one shared real Postgres pool. Each is a real listening HTTP server.
export async function startServices(pool: pg.Pool): Promise<Services> {
  const economy = await serveHono(
    createEconomyApp({ db: new PgEconomyDb(pool), verifiers: economyTestVerifiers(SERVICE_SECRET) })
  );
  const content = await serveHono(createContentApp({ db: new PgContentDb(pool) }));
  const decision = await serveHono(
    createDecisionApp({ decisionDeps: await makeDecisionDeps(pool), verifiers: decisionTestVerifiers() })
  );

  // Manifest is served by its own node:http entry point (startServer), pointed at a Postgres-backed
  // ManifestDB so the playlist comes from the same database as the rest of the flow.
  const { server: manifestServer, port: manifestPort } = await startManifestServer(
    new PgManifestDb(pool)
  );
  const manifest: RunningServer = {
    baseUrl: `http://127.0.0.1:${manifestPort}`,
    server: manifestServer,
    stop: () =>
      new Promise<void>((res, rej) => manifestServer.close((e) => (e ? rej(e) : res()))),
  };

  return {
    economy,
    decision,
    content,
    manifest,
    stopAll: async () => {
      await Promise.all([economy.stop(), decision.stop(), content.stop(), manifest.stop()]);
    },
  };
}
