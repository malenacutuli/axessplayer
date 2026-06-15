// Local media upload + serve server for the Studio "upload a real video and watch it" loop. This stands
// in for the production generation/encode pipeline + CDN (out of scope locally): it stores an uploaded
// master to disk and serves it back with HTTP Range support so a <video> can seek. The Studio uploads the
// chosen file here and registers the returned URL as the beat_variant playback_url; both the Studio
// preview and the consumer player then play it. Permissive CORS so the browser can talk to it directly
// from either app origin. NOT for production. No em dashes.

import { createServer } from "node:http";
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = process.env.MEDIA_UPLOAD_DIR ?? join(HERE, "uploads");
const PORT = Number(process.env.PORT ?? 8095);
const HOST = process.env.HOST ?? "127.0.0.1";
const PUBLIC_ORIGIN = process.env.MEDIA_PUBLIC_ORIGIN ?? `http://${HOST}:${PORT}`;

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const CONTENT_TYPES = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".ogg": "video/ogg",
};

function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, PUT, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-expose-headers", "content-range, accept-ranges, content-length, location");
}

function safeName(name) {
  return (name || "master")
    .replace(/\.[^.]*$/, (m) => m.toLowerCase())
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "master";
}

function uniqueId() {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

const server = createServer((req, res) => {
  cors(res);
  const url = new URL(req.url, PUBLIC_ORIGIN);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  // Upload: PUT or POST /upload or /upload/<name>. The body is the raw file bytes, streamed to disk.
  if ((req.method === "PUT" || req.method === "POST") && url.pathname.startsWith("/upload")) {
    const hinted = decodeURIComponent(url.pathname.replace(/^\/upload\/?/, "")) || url.searchParams.get("name") || "master";
    const base = safeName(hinted);
    const ext = extname(base) || extFromType(req.headers["content-type"]) || ".mp4";
    const stored = `${uniqueId()}-${base.endsWith(ext) ? base : base + ext}`;
    const dest = join(UPLOAD_DIR, stored);
    const out = createWriteStream(dest);
    req.pipe(out);
    out.on("finish", () => {
      const size = existsSync(dest) ? statSync(dest).size : 0;
      res.writeHead(201, { "content-type": "application/json", location: `${PUBLIC_ORIGIN}/media/${stored}` });
      res.end(JSON.stringify({ url: `${PUBLIC_ORIGIN}/media/${stored}`, name: stored, size }));
    });
    out.on("error", () => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "write_failed" }));
    });
    return;
  }

  // Serve: GET /media/<file> with Range support so the <video> can seek.
  if (req.method === "GET" && url.pathname.startsWith("/media/")) {
    const name = decodeURIComponent(url.pathname.replace("/media/", ""));
    const filePath = resolve(UPLOAD_DIR, name);
    // Path traversal guard: the resolved path must stay inside UPLOAD_DIR.
    if (!filePath.startsWith(resolve(UPLOAD_DIR) + "/") || !existsSync(filePath)) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    const stat = statSync(filePath);
    const type = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Number(m[2]) : stat.size - 1;
      if (start >= stat.size || end >= stat.size || start > end) {
        res.writeHead(416, { "content-range": `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        "content-type": type,
        "content-range": `bytes ${start}-${end}/${stat.size}`,
        "accept-ranges": "bytes",
        "content-length": end - start + 1,
      });
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { "content-type": type, "content-length": stat.size, "accept-ranges": "bytes" });
    createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

function extFromType(t) {
  if (!t) return null;
  const base = String(t).split(";")[0].trim();
  for (const [ext, type] of Object.entries(CONTENT_TYPES)) if (type === base) return ext;
  return null;
}

server.listen(PORT, HOST, () => {
  console.log(`media-server listening on ${PUBLIC_ORIGIN} (uploads in ${UPLOAD_DIR})`);
});
