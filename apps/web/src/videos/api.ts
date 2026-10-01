// Client for standalone creator videos (platform v2): the home rows, the shorts feed, one video, and its
// short-lived signed playback URL. Identity rides the session bearer (signed out = guest). No em dashes.
import { apiFetch } from "../api/http.js";
import type { SessionProvider } from "../api/session.js";

export type Orientation = "vertical" | "horizontal" | "square";

export interface Video {
  id: string;
  title: string;
  description: string | null;
  channel: { id: string; name: string };
  orientation: Orientation | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  format: "short" | "long" | null;
  language: string;
  category: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  views: number;
  accessibility: { captions: boolean; audio_description: boolean; sign: boolean; dubs: string[] };
  sponsor: { brand: string; disclosure: string } | null;
}

export interface HomeRow {
  id: string;
  title: string;
  items: Video[];
}

export interface VideosClient {
  home(): Promise<{ rows: HomeRow[] }>;
  shorts(cursor?: string | null): Promise<{ items: Video[]; next_cursor: string | null }>;
  get(id: string): Promise<Video>;
  playback(id: string): Promise<{ playback_url: string }>;
}

export function createVideosClient(opts: { baseUrl: string; session: SessionProvider; fetch?: typeof fetch }): VideosClient {
  const f = { ...(opts.fetch ? { fetch: opts.fetch } : {}) };
  const get = <T,>(path: string) => apiFetch<T>(opts.baseUrl, path, opts.session, f);
  return {
    home: () => get("/feed/home"),
    shorts: (cursor) => get(`/feed/shorts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
    get: (id) => get(`/videos/${encodeURIComponent(id)}`),
    playback: (id) => get(`/videos/${encodeURIComponent(id)}/playback`),
  };
}

// CSS aspect ratio for a video, defaulting by orientation when the exact size is unknown.
export function aspectOf(v: Pick<Video, "width" | "height" | "orientation">): string {
  if (v.width && v.height) return `${v.width} / ${v.height}`;
  return v.orientation === "horizontal" ? "16 / 9" : v.orientation === "square" ? "1 / 1" : "9 / 16";
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
