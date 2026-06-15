// Served entry point for the manifest service. The core is createHandler(db), a Web fetch handler
// (Request => Promise<Response>) that nothing listens on by itself. This wraps it in a real node:http
// server so the service runs as an HTTP process: locally, in tests, or wherever a Node runtime hosts it.
// node:http is used instead of an external server package so no dependency or lockfile change is needed
// and the adapter stays explicit. createHandler is consumed unchanged. No em dashes.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { InMemoryManifestDB, FIXTURE_VARIANTS, FIXTURE_RENDITIONS, type ManifestDB } from "./db.js";
import { createHandler } from "./index.js";

// Translate a Node request into a Web Request so the existing fetch handler can serve it untouched.
// GET only on this surface, so there is no body to forward; the path and method are what the handler reads.
function toWebRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? "manifest.local";
  const url = `http://${host}${req.url ?? "/"}`;
  const method = req.method ?? "GET";
  return new Request(url, { method });
}

// Copy a Web Response back onto the Node response: status, headers, then the body bytes.
async function writeWebResponse(res: ServerResponse, webRes: Response): Promise<void> {
  const headers: Record<string, string> = {};
  webRes.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(webRes.status, headers);
  const buf = Buffer.from(await webRes.arrayBuffer());
  res.end(buf);
}

// Build a node:http server bound to the given DB-backed fetch handler. Each request is mapped to a Web
// Request, handed to createHandler, and the resulting Web Response is written back. The handler is a pure
// function of the path, so the server holds no per-request state.
export function createServerForDB(db: ManifestDB): Server {
  const handler = createHandler(db);
  return createServer((req, res) => {
    void (async () => {
      try {
        const webRes = await handler(toWebRequest(req));
        await writeWebResponse(res, webRes);
      } catch {
        // Defensive: the handler is total over this surface, but never leak a hung socket on a surprise.
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        }
        res.end(JSON.stringify({ error: "internal_error" }));
      }
    })();
  });
}

// Start listening on the given port (0 picks an ephemeral port). Resolves with the server and the bound
// port so callers (and tests) can issue real HTTP requests against it.
//
// host defaults to 0.0.0.0 so the listener is reachable through a container port map. A process bound to
// 127.0.0.1 only answers on the loopback inside the container and is unreachable from the host even with
// `-p`, which is exactly the symptom this entrypoint exists to avoid. Tests pass host explicitly when
// they want loopback only. Env HOST overrides on direct execution below. No em dashes.
export function startServer(
  db: ManifestDB,
  port = 0,
  host = "0.0.0.0"
): Promise<{ server: Server; port: number }> {
  const server = createServerForDB(db);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address() as AddressInfo;
      resolve({ server, port: address.port });
    });
  });
}

// Direct execution: `node --import tsx src/server.ts` serves the fixture DB on PORT (default 8787) bound to
// HOST (default 0.0.0.0 so a container port map reaches it). This is a STUB datastore: the fixture
// playback_urls are placeholders, not real transcoded segments. Swap in the Supabase-backed ManifestDB here
// when it exists.
//
// Env vars read here (must match infra/ENV.md):
//   PORT  TCP port the listener binds. Defaults to 8787 (matches the Dockerfile EXPOSE/ENV).
//   HOST  Interface to bind. Defaults to 0.0.0.0 for container reachability.
// Start the listener from the process environment. Called UNCONDITIONALLY by the guard-free entry file
// src/serve.ts (the package `serve` script points node at that file). The previous is-main guard evaluated
// FALSE under `node --import tsx src/server.ts` run via pnpm, so the listener never started in the
// container. Extracting the start logic here and invoking it from a tiny no-guard entry makes startup
// deterministic. Sets process.exitCode on failure rather than letting the rejection escape the caller.
export async function runServer(): Promise<void> {
  try {
    const port = Number(process.env.PORT ?? 8787);
    const host = process.env.HOST ?? "0.0.0.0";
    const db = new InMemoryManifestDB(FIXTURE_VARIANTS, FIXTURE_RENDITIONS);
    const { port: bound } = await startServer(db, port, host);
    // eslint-disable-next-line no-console
    console.log(`manifest service listening on ${host}:${bound}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("failed to start manifest server", err);
    process.exitCode = 1;
  }
}
