// Migrate a local media-server upload dir to PUBLIC Supabase storage so a deployed app (web or mobile) can
// fetch the video + accessibility tracks off-machine. Video -> the public `videos` bucket; every other track
// (caption/AD/sign/dub json, webm, m4a, mp3) -> the public `thumbnails` bucket (mime-unrestricted, public).
// Prints a JSON map of original filename -> public URL so the caller can rewrite the variant track URLs.
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env. No em dashes.
//
// Usage: node tools/deploy/migrate-media.mjs <localDir> <destPrefix>
//   e.g. node tools/deploy/migrate-media.mjs tools/media-server/uploads/mqfkdb5y-9lzxgp mqfkdb5y

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const SB = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dir = process.argv[2];
const prefix = process.argv[3] || "media";
if (!SB || !KEY) { console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required in env"); process.exit(2); }
if (!dir) { console.error("usage: migrate-media.mjs <localDir> <destPrefix>"); process.exit(2); }

const VIDEO_BUCKET = "videos";
const TRACK_BUCKET = "thumbnails"; // public, mime-unrestricted catch-all for json/webm/m4a/mp3 tracks
const CT = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".json": "application/json", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".aiff": "audio/aiff",
};
// Only migrate the asset kinds the player fetches; skip HLS segments + the working wav/intermediates.
const SKIP = /\.(ts|wav|m3u8)$/i;
const KEEP = /\.(mp4|mov|webm|json|m4a|mp3)$/i;

const publicUrl = (bucket, path) => `${SB}/storage/v1/object/public/${bucket}/${path}`;

async function upload(bucket, path, bytes, contentType) {
  const res = await fetch(`${SB}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, apikey: KEY, "content-type": contentType, "x-upsert": "true" },
    body: bytes,
  });
  if (!res.ok && res.status !== 200) {
    const t = await res.text().catch(() => "");
    throw new Error(`upload ${bucket}/${path} -> ${res.status}: ${t.slice(0, 140)}`);
  }
}

const map = {};
for (const name of readdirSync(dir)) {
  const full = join(dir, name);
  if (!statSync(full).isFile() || SKIP.test(name) || !KEEP.test(name)) continue;
  const ext = extname(name).toLowerCase();
  const isVideo = /\.(mp4|mov|webm)$/i.test(name) && !/_sign\.webm$/i.test(name); // sign clips are tracks
  const bucket = isVideo ? VIDEO_BUCKET : TRACK_BUCKET;
  const dest = `${prefix}/${name}`;
  const ct = CT[ext] || "application/octet-stream";
  process.stdout.write(`uploading ${name} -> ${bucket}/${dest} ... `);
  await upload(bucket, dest, readFileSync(full), ct);
  map[name] = publicUrl(bucket, dest);
  console.log("ok");
}
console.log("PUBLIC_URL_MAP " + JSON.stringify(map));
