#!/usr/bin/env node
// Move existing variant media (videos hosted in Supabase Storage / r2.dev) into Cloudflare Stream.
//
//   DATABASE_URL=... DB_OPTIONS="-c search_path=mobile,public" \
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_STREAM_API_TOKEN=... \
//   node services/content/scripts/migrate-media-to-stream.mjs            # dry run: lists what would move
//   node services/content/scripts/migrate-media-to-stream.mjs --apply    # imports into Stream (copy by URL)
//
// For each beat variant with a real, absolute video file URL and no Stream video yet, Stream copies the file
// (requireSignedURLs on). The variant is marked stream_status 'uploading'; when Stream's webhook reports it
// ready, the content service switches it to signed Stream playback (playback_url = stream:<uid>). Until then
// the old URL keeps playing, so viewers see no gap. Placeholders, relative media-server paths, and HLS
// playlists (not importable by URL) are skipped.
//
// Rollback: --apply writes stream-migration-<timestamp>.json mapping variant id -> old playback_url; restore
// with: update beat_variants set playback_url = <old>, stream_uid = null, stream_status = null,
//       stream_hls = null where id = <id>. No em dashes.

import { writeFileSync } from "node:fs";

export const IMPORTABLE = /^https?:\/\/[^\s]+\.(mp4|m4v|mov|webm)(\?.*)?$/i;

// Hosts Stream cannot fetch from (a developer machine or a private network): such rows are broken media in
// production anyway and are reported, not imported.
export const UNREACHABLE_HOST = /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0)/i;

export function selectForMigration(rows) {
  return rows.filter(
    (r) =>
      !r.stream_uid &&
      typeof r.playback_url === "string" &&
      IMPORTABLE.test(r.playback_url) &&
      !r.playback_url.includes("cdn.example") &&
      !UNREACHABLE_HOST.test(r.playback_url),
  );
}

export function unreachable(rows) {
  return rows.filter((r) => typeof r.playback_url === "string" && UNREACHABLE_HOST.test(r.playback_url));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { DATABASE_URL, DB_OPTIONS, CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_STREAM_API_TOKEN: token } = process.env;
  if (!DATABASE_URL || (apply && (!account || !token))) {
    console.error("Set DATABASE_URL (and CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_STREAM_API_TOKEN for --apply).");
    process.exit(2);
  }
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: DATABASE_URL, ...(DB_OPTIONS ? { options: DB_OPTIONS } : {}) });
  try {
    const { rows } = await pool.query(
      `select v.id, v.playback_url, v.stream_uid, s.title as series_title, s.owner_id
         from beat_variants v join beats b on b.id = v.beat_id join series s on s.id = b.series_id
        order by s.title, v.id`,
    );
    const todo = selectForMigration(rows);
    console.log(`${rows.length} variants, ${todo.length} importable into Stream${apply ? "" : " (dry run)"}`);
    for (const r of todo) console.log(`  ${r.series_title} | ${r.id} | ${r.playback_url.slice(0, 90)}`);
    const broken = unreachable(rows);
    if (broken.length) {
      console.log(`${broken.length} variants point at a local/private host (unplayable in production; re-upload them):`);
      for (const r of broken) console.log(`  ${r.series_title} | ${r.id} | ${r.playback_url.slice(0, 90)}`);
    }
    if (!apply || todo.length === 0) return;

    const log = [];
    for (const r of todo) {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/stream/copy`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          url: r.playback_url,
          meta: { name: `${r.series_title} ${r.id}` },
          requireSignedURLs: true,
          ...(r.owner_id ? { creator: String(r.owner_id) } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      const uid = body?.result?.uid;
      if (!res.ok || !uid) {
        console.error(`  FAILED ${r.id}: HTTP ${res.status}`);
        continue;
      }
      await pool.query("update beat_variants set stream_uid = $2, stream_status = 'uploading' where id = $1 and stream_uid is null", [r.id, uid]);
      log.push({ id: r.id, old_playback_url: r.playback_url, stream_uid: uid });
      console.log(`  queued ${r.id} -> ${uid}`);
    }
    const file = `stream-migration-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(file, JSON.stringify(log, null, 2));
    console.log(`\n${log.length}/${todo.length} queued. Rollback map: ${file}`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
