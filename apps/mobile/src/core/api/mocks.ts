// In-memory ContentClient for development (EXPO_PUBLIC_USE_MOCKS=1) and for tests. It implements the same
// contract as the real client so screens can be exercised before the content service ships the v2
// endpoints. The playback urls are public HLS test streams (Apple's bipbop example carries WebVTT
// subtitles in its manifest, which exercises the captions track selection). No em dashes.

import type { ApiResult } from "./http";
import type { ContentClient } from "./content";
import type { HomeFeed, Playback, ShortsPage, Video } from "./types";

const BIPBOP = "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8";
const BUNNY = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

function video(partial: Partial<Video> & Pick<Video, "id" | "title">): Video {
  return {
    description: null,
    channel: { id: "ch-demo", name: "Axessplayer Demo" },
    orientation: "vertical",
    width: 1080,
    height: 1920,
    duration_ms: 30000,
    format: "short",
    language: "en",
    category: null,
    thumbnail_url: null,
    published_at: "2026-10-01T00:00:00Z",
    accessibility: { captions: true, audio_description: false, sign: false, dubs: [] },
    sponsor: null,
    ...partial,
  };
}

export const MOCK_VIDEOS: Video[] = [
  video({ id: "mock-short-1", title: "Sign language greetings in 30 seconds", accessibility: { captions: true, audio_description: false, sign: true, dubs: [] } }),
  video({ id: "mock-short-2", title: "Street food tour", sponsor: { brand: "Acme Foods", disclosure: "Paid partnership with Acme Foods" } }),
  video({ id: "mock-short-3", title: "Wheelchair skate tricks", accessibility: { captions: true, audio_description: true, sign: false, dubs: ["es", "pt"] } }),
  video({ id: "mock-short-4", title: "Square format recipe", orientation: "square", width: 1080, height: 1080 }),
  video({ id: "mock-long-1", title: "Big Buck Bunny", orientation: "horizontal", width: 1920, height: 1080, duration_ms: 596000, format: "long", category: "Animation", accessibility: { captions: false, audio_description: false, sign: false, dubs: [] } }),
  video({ id: "mock-long-2", title: "Bip bop: captions demo", orientation: "horizontal", width: 1920, height: 1080, duration_ms: 1800000, format: "long", category: "Demo", description: "An HLS stream with WebVTT subtitles in the manifest.", accessibility: { captions: true, audio_description: false, sign: false, dubs: ["fr"] } }),
];

const PLAYBACK: Record<string, string> = {
  "mock-long-1": BUNNY,
};

export function createMockContentClient(videos: Video[] = MOCK_VIDEOS, pageSize = 2): ContentClient {
  const shorts = videos.filter((v) => v.format === "short");
  const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });
  return {
    async getShorts(cursor) {
      const start = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
      const items = shorts.slice(start, start + pageSize);
      const next = start + pageSize < shorts.length ? String(start + pageSize) : null;
      return ok<ShortsPage>({ items, next_cursor: next });
    },
    async getHome() {
      return ok<HomeFeed>({
        rows: [
          { id: "row-new", title: "New on Axessplayer", items: videos.filter((v) => v.format === "long") },
          { id: "row-shorts", title: "Trending shorts", items: shorts },
          { id: "row-a11y", title: "Fully accessible", items: videos.filter((v) => v.accessibility.captions && (v.accessibility.sign || v.accessibility.audio_description)) },
        ].filter((r) => r.items.length > 0),
      });
    },
    async getVideo(id) {
      const v = videos.find((x) => x.id === id);
      return v ? ok(v) : { ok: false, reason: "not_found", status: 404 };
    },
    async getPlayback(id) {
      if (!videos.some((x) => x.id === id)) return { ok: false, reason: "not_found", status: 404 };
      return ok<Playback>({ playback_url: PLAYBACK[id] ?? BIPBOP });
    },
  };
}
