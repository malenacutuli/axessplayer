// Tests for the manifest service. Runner: node --test with tsx (Node 20). NodeNext .js specifiers resolve
// to the .ts sources. Playlists are validated by an actual parser (test/m3u8.ts), not string matching.
// No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  InMemoryManifestDB,
  FIXTURE_VARIANTS,
  FIXTURE_RENDITIONS,
  type BeatVariantRow,
} from "../src/db.js";
import {
  handleManifest,
  HLS_CONTENT_TYPE,
  MANIFEST_CACHE_CONTROL,
  SEGMENT_CACHE_CONTROL,
} from "../src/manifest.js";
import { createHandler } from "../src/index.js";
import { buildMediaPlaylist, TARGET_SEGMENT_SECONDS } from "../src/hls.js";
import { parseM3U8, type ParsedMediaPlaylist, type ParsedMasterPlaylist } from "./m3u8.js";

const KNOWN_SINGLE = "cccccccc-0000-0000-0000-00000000000a"; // calm cut, single rendition
const KNOWN_ABR = "cccccccc-0000-0000-0000-00000000000b"; // tense cut, has ABR ladder
const UNKNOWN = "ffffffff-ffff-ffff-ffff-ffffffffffff";

function db(): InMemoryManifestDB {
  return new InMemoryManifestDB(FIXTURE_VARIANTS, FIXTURE_RENDITIONS);
}

test("known single-rendition variant returns a parseable media playlist with segments", async () => {
  const res = await handleManifest(KNOWN_SINGLE, db());
  assert.equal(res.status, 200);
  assert.equal(res.contentType, HLS_CONTENT_TYPE);

  const parsed = parseM3U8(res.body) as ParsedMediaPlaylist;
  assert.equal(parsed.kind, "media");
  assert.ok(parsed.segments.length > 0, "expected at least one segment");
  assert.equal(parsed.playlistType, "VOD");
  assert.ok(parsed.endList, "VOD playlist must end with EXT-X-ENDLIST");
  assert.ok(parsed.independentSegments, "segments must be independently decodable for seamless switching");
  assert.ok(parsed.mapUri, "CMAF playlist must carry an EXT-X-MAP init segment");
});

test("segment count matches duration split at the target segment length", async () => {
  // calm fixture is 15000ms; at 4s targets that is 3 full plus a 3s tail = 4 segments.
  const variant = FIXTURE_VARIANTS.find((v) => v.id === KNOWN_SINGLE) as BeatVariantRow;
  const res = await handleManifest(KNOWN_SINGLE, db());
  const parsed = parseM3U8(res.body) as ParsedMediaPlaylist;
  const expected = Math.ceil((variant.duration_ms as number) / 1000 / TARGET_SEGMENT_SECONDS);
  assert.equal(parsed.segments.length, expected);
});

test("ABR variant returns a multivariant master playlist with the default cut first", async () => {
  const res = await handleManifest(KNOWN_ABR, db());
  assert.equal(res.status, 200);
  const parsed = parseM3U8(res.body) as ParsedMasterPlaylist;
  assert.equal(parsed.kind, "master");
  assert.equal(parsed.streams.length, FIXTURE_RENDITIONS[KNOWN_ABR].length);
  // The default-cut fallback (lowest bandwidth) must be listed first for low-bandwidth start.
  const lowest = Math.min(...FIXTURE_RENDITIONS[KNOWN_ABR].map((r) => r.bandwidth));
  assert.equal(parsed.streams[0].bandwidth, lowest);
  // Bandwidths must be non decreasing after the default.
  for (let i = 1; i < parsed.streams.length; i++) {
    assert.ok(parsed.streams[i].bandwidth >= parsed.streams[i - 1].bandwidth);
  }
});

test("unknown variant returns 404 variant_not_found as JSON", async () => {
  const res = await handleManifest(UNKNOWN, db());
  assert.equal(res.status, 404);
  assert.equal(res.contentType, "application/json");
  const body = JSON.parse(res.body);
  assert.equal(body.error, "variant_not_found");
});

test("manifest cache headers cache at segment granularity, never per viewer", async () => {
  const res = await handleManifest(KNOWN_SINGLE, db());
  // The manifest itself is cheap and short-lived but shared (public), never private/per viewer.
  assert.equal(res.headers["Cache-Control"], MANIFEST_CACHE_CONTROL);
  assert.match(res.headers["Cache-Control"], /public/);
  assert.doesNotMatch(res.headers["Cache-Control"], /private|no-store/);
  // The advertised segment cache policy is the long immutable TTL: that is where the value lives.
  assert.equal(res.headers["X-Segment-Cache-Control"], SEGMENT_CACHE_CONTROL);
  assert.match(res.headers["X-Segment-Cache-Control"], /immutable/);
  // Nothing viewer specific in Vary (PF-6: no session id).
  assert.doesNotMatch(res.headers["Vary"] ?? "", /cookie|authorization/i);
});

test("404 is not cached", async () => {
  const res = await handleManifest(UNKNOWN, db());
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("null duration still yields a parseable single-segment playlist", () => {
  const body = buildMediaPlaylist("https://cdn.example/skel/x.m3u8", null);
  const parsed = parseM3U8(body) as ParsedMediaPlaylist;
  assert.equal(parsed.kind, "media");
  assert.equal(parsed.segments.length, 1);
});

test("two viewers of the same variant get identical segment URIs (shared cache key)", async () => {
  const a = parseM3U8((await handleManifest(KNOWN_SINGLE, db())).body) as ParsedMediaPlaylist;
  const b = parseM3U8((await handleManifest(KNOWN_SINGLE, db())).body) as ParsedMediaPlaylist;
  assert.deepEqual(
    a.segments.map((s) => s.uri),
    b.segments.map((s) => s.uri)
  );
});

// Edge-worker route tests.

test("worker route serves the playlist for a valid variant path", async () => {
  const handler = createHandler(db());
  const res = await handler(new Request(`https://edge.test/manifest/${KNOWN_SINGLE}.m3u8`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), HLS_CONTENT_TYPE);
  const parsed = parseM3U8(await res.text());
  assert.equal(parsed.kind, "media");
});

test("worker route 404s an unknown variant", async () => {
  const handler = createHandler(db());
  const res = await handler(new Request(`https://edge.test/manifest/${UNKNOWN}.m3u8`));
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal((body as { error: string }).error, "variant_not_found");
});

test("worker route 404s a malformed (non uuid) variant path", async () => {
  const handler = createHandler(db());
  const res = await handler(new Request("https://edge.test/manifest/not-a-uuid.m3u8"));
  assert.equal(res.status, 404);
});

test("worker rejects non GET methods", async () => {
  const handler = createHandler(db());
  const res = await handler(
    new Request(`https://edge.test/manifest/${KNOWN_SINGLE}.m3u8`, { method: "POST" })
  );
  assert.equal(res.status, 405);
});

// Guard the parser itself so a green suite cannot hide a broken validator.
test("parser rejects a playlist that does not start with EXTM3U", () => {
  assert.throws(() => parseM3U8("#EXT-X-VERSION:7\n"), /must start with #EXTM3U/);
});

test("parser rejects a media playlist with a segment over TARGETDURATION", () => {
  const bad = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-TARGETDURATION:4", "#EXTINF:9.0,", "seg.m4s", "#EXT-X-ENDLIST"].join("\n");
  assert.throws(() => parseM3U8(bad), /exceeds TARGETDURATION/);
});
