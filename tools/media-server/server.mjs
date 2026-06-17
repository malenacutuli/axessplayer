// Local media INGEST server: upload -> real ffmpeg HLS encode -> ready, with an explicit job lifecycle the
// Studio polls. This is the real ingestion path (the production generation pipeline does this at scale on
// S3/CDN; here it runs ffmpeg locally). States: encoding -> ready{master_url} | failed{reason}. Serves the
// HLS output (master.m3u8 + .ts segments) with Range support so hls.js / a <video> can play and seek.
// Permissive CORS so the browser talks to it directly. NOT for production. No em dashes.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = process.env.MEDIA_UPLOAD_DIR ?? join(HERE, "uploads");
const PORT = Number(process.env.PORT ?? 8095);
const HOST = process.env.HOST ?? "127.0.0.1";
const PUBLIC_ORIGIN = process.env.MEDIA_PUBLIC_ORIGIN ?? `http://${HOST}:${PORT}`;
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const CONTENT_TYPES = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

// jobId -> { status: 'encoding'|'ready'|'failed', master_url?, reason?, name, created_at }
const jobs = new Map();

function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, PUT, POST, DELETE, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-expose-headers", "content-range, accept-ranges, content-length, location");
}

function safeName(name) {
  return (
    (name || "master")
      .replace(/\.[^.]*$/, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "master"
  );
}

function uniqueId() {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

// Real HLS encode: source.<ext> -> master.m3u8 + seg_*.ts. Updates the job on completion.
function encode(id, srcPath, outDir) {
  const args = [
    "-y",
    "-i", srcPath,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-profile:v", "main",
    "-c:a", "aac",
    "-ac", "2",
    "-hls_time", "4",
    "-hls_playlist_type", "vod",
    "-hls_segment_filename", join(outDir, "seg_%03d.ts"),
    join(outDir, "master.m3u8"),
  ];
  let stderr = "";
  let proc;
  try {
    proc = spawn(FFMPEG, args);
  } catch (err) {
    const job = jobs.get(id);
    if (job) {
      job.status = "failed";
      job.reason = `ffmpeg not runnable: ${err instanceof Error ? err.message : "spawn error"}`;
    }
    return;
  }
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
    if (stderr.length > 8000) stderr = stderr.slice(-8000);
  });
  proc.on("error", (err) => {
    const job = jobs.get(id);
    if (job) {
      job.status = "failed";
      job.reason = `ffmpeg not found or failed to start: ${err.message}`;
    }
  });
  proc.on("close", (code) => {
    const job = jobs.get(id);
    if (!job) return;
    if (code === 0 && existsSync(join(outDir, "master.m3u8"))) {
      job.status = "ready";
      job.master_url = `${PUBLIC_ORIGIN}/media/${id}/master.m3u8`;
    } else {
      job.status = "failed";
      job.reason = (stderr.split("\n").filter(Boolean).slice(-3).join(" | ") || `ffmpeg exited ${code}`).slice(0, 500);
    }
  });
}

function serveFile(req, res, filePath) {
  const stat = statSync(filePath);
  const type = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.range;
  if (range && type !== "application/vnd.apple.mpegurl") {
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

  // Job status: GET /jobs/<id>
  if (req.method === "GET" && url.pathname.startsWith("/jobs/")) {
    const id = url.pathname.replace("/jobs/", "");
    const job = jobs.get(id);
    if (!job) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "job_not_found" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ job_id: id, status: job.status, master_url: job.master_url, reason: job.reason }));
    return;
  }

  // Accessibility track listing: GET /tracks/<id> -> { files } present in the media dir (for P4-T2
  // self-attaching track URLs). Lists the accessibility outputs the pipeline wrote next to the master.
  if (req.method === "GET" && url.pathname.startsWith("/tracks/")) {
    const id = decodeURIComponent(url.pathname.replace(/^\/tracks\//, "").replace(/\/.*$/, ""));
    const dir = join(UPLOAD_DIR, id);
    let files = [];
    if (id && resolve(dir).startsWith(resolve(UPLOAD_DIR) + "/") && existsSync(dir)) {
      const TRACK = /^(captions\.json|ad\.json|[a-z]{2,3}_sign\.webm|[a-z]{2}_captions\.json|[a-z]{2}_ad\.json|[a-z]{2}_dub\.m4a)$/;
      try {
        files = readdirSync(dir).filter((f) => TRACK.test(f));
      } catch {
        files = [];
      }
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id, files }));
    return;
  }

  // Upload: PUT/POST /upload[/<name>] -> store, start an async encode, return a job in "encoding".
  if ((req.method === "PUT" || req.method === "POST") && url.pathname.startsWith("/upload")) {
    const hinted = decodeURIComponent(url.pathname.replace(/^\/upload\/?/, "")) || url.searchParams.get("name") || "master";
    const base = safeName(hinted);
    const ext = extname(decodeURIComponent(url.pathname)) || extFromType(req.headers["content-type"]) || ".mp4";
    const id = uniqueId();
    const outDir = join(UPLOAD_DIR, id);
    mkdirSync(outDir, { recursive: true });
    const srcPath = join(outDir, `source${ext.startsWith(".") ? ext : `.${ext}`}`);
    const out = createWriteStream(srcPath);
    req.pipe(out);
    out.on("finish", () => {
      jobs.set(id, { status: "encoding", name: `${base}${ext}`, created_at: Date.now() });
      encode(id, srcPath, outDir);
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ job_id: id, status: "encoding", status_url: `${PUBLIC_ORIGIN}/jobs/${id}` }));
    });
    out.on("error", () => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "write_failed" }));
    });
    return;
  }

  // Delete an uploaded video: DELETE /media/<id> -> remove the encoded output dir (master.m3u8 + segments +
  // source) and forget the job. Idempotent: a missing id still returns 200 deleted=false so the UI can prune a
  // row whose media is already gone. Path-traversal guarded: <id> must resolve inside UPLOAD_DIR.
  if (req.method === "DELETE" && url.pathname.startsWith("/media/")) {
    const id = decodeURIComponent(url.pathname.replace(/^\/media\//, "").replace(/\/.*$/, ""));
    const dir = resolve(UPLOAD_DIR, id);
    if (!id || !dir.startsWith(resolve(UPLOAD_DIR) + "/")) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_id" }));
      return;
    }
    const existed = existsSync(dir);
    if (existed) rmSync(dir, { recursive: true, force: true });
    jobs.delete(id);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id, deleted: existed }));
    return;
  }

  // Serve HLS + media: GET /media/<id>/<file> (or a legacy flat /media/<file>).
  if (req.method === "GET" && url.pathname.startsWith("/media/")) {
    const rel = decodeURIComponent(url.pathname.replace("/media/", ""));
    const filePath = resolve(UPLOAD_DIR, rel);
    if (!filePath.startsWith(resolve(UPLOAD_DIR) + "/") || !existsSync(filePath) || statSync(filePath).isDirectory()) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    serveFile(req, res, filePath);
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
  console.log(`media-server (encode) listening on ${PUBLIC_ORIGIN} (uploads in ${UPLOAD_DIR}, ffmpeg=${FFMPEG})`);
});
