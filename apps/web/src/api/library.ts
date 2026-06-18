// The library client (20-V4): the authed read + write surface for Saved, Downloads, History, Favorites,
// and Channel follows. Base from VITE_LIBRARY_BASE_URL. Every call goes through the shared apiFetch so
// the F1 trust boundary holds: identity is the session bearer token, never a body field (the server
// derives user_id from the session subject; we never send it). Every surface owns its own empty /
// loading / error state. No em dashes.

import { apiFetch, ApiError } from "./http.js";
import type { SessionProvider } from "./session.js";

export { ApiError };

// ---- GET/POST /saved + DELETE /saved/:seriesId -----------------------------
export interface SavedItem {
  seriesId: string;
  title: string;
  poster: string | null;
  createdAt: string;
}

// ---- GET/POST /favorites + DELETE /favorites -------------------------------
export type FavoriteTargetType = "show" | "character";
export interface FavoriteItem {
  targetType: FavoriteTargetType;
  targetId: string;
  // Display fields; the server returns them alongside the favorite row for rendering.
  title: string;
  subtitle: string | null;
  poster: string | null;
  createdAt: string;
}

// ---- GET /downloads + POST /downloads + PATCH /downloads/:seriesId ----------
export type DownloadStatus = "requested" | "ready" | "expired" | "failed";
export interface DownloadItem {
  seriesId: string;
  title: string;
  poster: string | null;
  episodeIds: string[];
  bytes: number;
  status: DownloadStatus;
  createdAt: string;
}

// ---- GET /history ----------------------------------------------------------
// Real watch events from engagement_events.
export interface HistoryItem {
  seriesId: string;
  title: string;
  poster: string | null;
  episodeId: string | null;
  // ISO timestamp of the watch event.
  watchedAt: string;
}

// ---- GET/POST /channel-follows + DELETE /channel-follows/:channelId ---------
export interface ChannelFollow {
  channelId: string;
  name: string;
  notify: boolean;
  createdAt: string;
}

export interface LibraryClient {
  // Saved.
  getSaved(): Promise<SavedItem[]>;
  saveSeries(seriesId: string): Promise<void>;
  unsaveSeries(seriesId: string): Promise<void>;
  // Favorites.
  getFavorites(): Promise<FavoriteItem[]>;
  addFavorite(targetType: FavoriteTargetType, targetId: string): Promise<void>;
  removeFavorite(targetType: FavoriteTargetType, targetId: string): Promise<void>;
  // Downloads.
  getDownloads(): Promise<DownloadItem[]>;
  startDownload(seriesId: string, episodeIds: string[]): Promise<void>;
  setDownloadStatus(seriesId: string, status: DownloadStatus): Promise<void>;
  // History.
  getHistory(): Promise<HistoryItem[]>;
  // Channel follows.
  getChannelFollows(): Promise<ChannelFollow[]>;
  followChannel(channelId: string, notify: boolean): Promise<void>;
  unfollowChannel(channelId: string): Promise<void>;
}

export interface LibraryClientOptions {
  baseUrl: string;
  session: SessionProvider;
  fetch?: typeof globalThis.fetch;
}

export function createLibraryClient(opts: LibraryClientOptions): LibraryClient {
  const { baseUrl, session } = opts;
  const f = opts.fetch;

  // Read a list endpoint that may return either a bare array or { items: [...] }.
  async function list<T>(path: string): Promise<T[]> {
    const raw = await apiFetch<T[] | { items: T[] }>(baseUrl, path, session, { fetch: f });
    return Array.isArray(raw) ? raw : (raw.items ?? []);
  }

  return {
    async getSaved() {
      return list<SavedItem>("/saved");
    },
    async saveSeries(seriesId) {
      await apiFetch<unknown>(baseUrl, "/saved", session, {
        method: "POST",
        body: { seriesId },
        fetch: f,
      });
    },
    async unsaveSeries(seriesId) {
      await apiFetch<unknown>(baseUrl, `/saved/${encodeURIComponent(seriesId)}`, session, {
        method: "DELETE",
        fetch: f,
      });
    },

    async getFavorites() {
      return list<FavoriteItem>("/favorites");
    },
    async addFavorite(targetType, targetId) {
      await apiFetch<unknown>(baseUrl, "/favorites", session, {
        method: "POST",
        body: { targetType, targetId },
        fetch: f,
      });
    },
    async removeFavorite(targetType, targetId) {
      // DELETE with a body: the contract identifies a favorite by (targetType,targetId), never user_id.
      await apiFetch<unknown>(baseUrl, "/favorites", session, {
        method: "DELETE",
        body: { targetType, targetId },
        fetch: f,
      });
    },

    async getDownloads() {
      return list<DownloadItem>("/downloads");
    },
    async startDownload(seriesId, episodeIds) {
      await apiFetch<unknown>(baseUrl, "/downloads", session, {
        method: "POST",
        body: { seriesId, episodeIds },
        fetch: f,
      });
    },
    async setDownloadStatus(seriesId, status) {
      await apiFetch<unknown>(baseUrl, `/downloads/${encodeURIComponent(seriesId)}`, session, {
        method: "PATCH",
        body: { status },
        fetch: f,
      });
    },

    async getHistory() {
      return list<HistoryItem>("/history");
    },

    async getChannelFollows() {
      return list<ChannelFollow>("/channel-follows");
    },
    async followChannel(channelId, notify) {
      await apiFetch<unknown>(baseUrl, "/channel-follows", session, {
        method: "POST",
        body: { channelId, notify },
        fetch: f,
      });
    },
    async unfollowChannel(channelId) {
      await apiFetch<unknown>(baseUrl, `/channel-follows/${encodeURIComponent(channelId)}`, session, {
        method: "DELETE",
        fetch: f,
      });
    },
  };
}
