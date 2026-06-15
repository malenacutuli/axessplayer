// Tests for the served HTTP entry point. Unlike manifest.test.ts (which exercises createHandler in process),
// these start a real node:http server on an ephemeral port and issue real network GETs, proving the wire is
// listening and the fetch handler is reachable over HTTP. Playlists are validated by the actual parser
// (test/m3u8.ts), not string matching. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

import { InMemoryManifestDB, FIXTURE_VARIANTS, FIXTURE_RENDITIONS } from "../src/db.js";
import { startServer } from "../src/server.js";
import { HLS_CONTENT_TYPE } from "../src/manifest.js";
import { parseM3U8, type ParsedMediaPlaylist } from "./m3u8.js";

const KNOWN_SINGLE = "cccccccc-0000-0000-0000-00000000000a"; // calm cut, single rendition
const UNKNOWN = "ffffffff-ffff-ffff-ffff-ffffffffffff";

function db(): InMemoryManifestDB {
  return new InMemoryManifestDB(FIXTURE_VARIANTS, FIXTURE_RENDITIONS);
}

// Run a function against a freshly started server on an ephemeral port, then always close it.
async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const { server, port } = await startServer(db(), 0);
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      (server as Server).close((err) => (err ? reject(err) : resolve()))
    );
  }
}

test("served entry: real GET of a known variant returns 200 with a parseable HLS playlist", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/manifest/${KNOWN_SINGLE}.m3u8`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), HLS_CONTENT_TYPE);

    const parsed = parseM3U8(await res.text()) as ParsedMediaPlaylist;
    assert.equal(parsed.kind, "media");
    assert.ok(parsed.segments.length > 0, "expected at least one segment");
    assert.ok(parsed.endList, "VOD playlist must end with EXT-X-ENDLIST");
  });
});

test("served entry: real GET of an unknown variant returns the documented 404", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/manifest/${UNKNOWN}.m3u8`);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("content-type"), "application/json");
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "variant_not_found");
  });
});

test("served entry: ephemeral port binding yields a real listening port", async () => {
  const { server, port } = await startServer(db(), 0);
  try {
    assert.ok(port > 0, "expected a bound ephemeral port");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});
