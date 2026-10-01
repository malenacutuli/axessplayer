// Which variants the Stream media migration picks: real absolute video files only. No em dashes.
import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error plain ESM script without types
import { selectForMigration, unreachable } from "../scripts/migrate-media-to-stream.mjs";

test("migration selects absolute video files without a Stream video, and skips everything else", () => {
  const rows = [
    { id: "a", playback_url: "https://x.supabase.co/storage/v1/object/public/videos/ep1.mp4", stream_uid: null },
    { id: "b", playback_url: "https://pub-1.r2.dev/axessplayer/master.MOV?x=1", stream_uid: null },
    { id: "c", playback_url: "https://x.supabase.co/storage/v1/object/public/videos/ep2.mp4", stream_uid: "already" },
    { id: "d", playback_url: "https://cdn.example/placeholder/1.mp4", stream_uid: null },
    { id: "e", playback_url: "/media/abc/master.m3u8", stream_uid: null },
    { id: "f", playback_url: "https://host/x/master.m3u8", stream_uid: null },
    { id: "g", playback_url: "stream:uid9", stream_uid: "uid9" },
    { id: "h", playback_url: "http://127.0.0.1:8095/media/hero/cliff1-slow.mp4", stream_uid: null },
    { id: "i", playback_url: "http://192.168.1.4/x.mp4", stream_uid: null },
  ];
  assert.deepEqual(selectForMigration(rows).map((r: { id: string }) => r.id), ["a", "b"]);
});

test("local and private hosts are reported, never imported", () => {
  const rows = [
    { id: "h", playback_url: "http://127.0.0.1:8095/media/hero/cliff1-slow.mp4", stream_uid: null },
    { id: "a", playback_url: "https://x.supabase.co/storage/v1/object/public/videos/ep1.mp4", stream_uid: null },
  ];
  assert.deepEqual(unreachable(rows).map((r: { id: string }) => r.id), ["h"]);
});
