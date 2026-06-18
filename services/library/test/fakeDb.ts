// In-memory fake LibraryDB for unit tests. It faithfully reproduces the two properties the production
// pg adapter relies on: ownership scoping (every row is keyed by user_id, so one user can never read or
// mutate another's rows) and idempotency (a repeat add is a no-op on the key). It is the test stand-in for
// node-postgres; the SQL adapter (pgLibraryDb.ts) is the same shape over Postgres. No em dashes.

import type {
  LibraryDB,
  SavedRow,
  FavoriteRow,
  DownloadRow,
  ChannelFollowRow,
  HistoryRow,
  TargetType,
  DownloadStatus,
} from "../src/library.js";

interface StoredDownload extends DownloadRow {}

export interface SeedHistoryEvent {
  userId: string;
  event: string;
  seriesId: string;
  seriesTitle: string | null;
  occurredAt: string;
}

// A fake whose maps are keyed by the user id FIRST. There is no API to read across users, which is exactly
// the ownership guarantee under test: a handler given user A's id physically cannot reach user B's bucket.
export class FakeLibraryDb implements LibraryDB {
  private saved = new Map<string, Map<string, SavedRow>>();
  private favorites = new Map<string, Map<string, FavoriteRow>>();
  private downloads = new Map<string, Map<string, StoredDownload>>();
  private follows = new Map<string, Map<string, ChannelFollowRow>>();
  private history: SeedHistoryEvent[] = [];
  private clock = 0;

  // deterministic monotonically-increasing timestamps so ordering assertions are stable
  private now(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private bucket<T>(m: Map<string, Map<string, T>>, userId: string): Map<string, T> {
    let b = m.get(userId);
    if (b == null) {
      b = new Map();
      m.set(userId, b);
    }
    return b;
  }

  // ---- saved
  async listSaved(userId: string): Promise<SavedRow[]> {
    return [...this.bucket(this.saved, userId).values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }
  async addSaved(userId: string, seriesId: string): Promise<SavedRow> {
    const b = this.bucket(this.saved, userId);
    const existing = b.get(seriesId);
    if (existing) return existing; // idempotent
    const row: SavedRow = { seriesId, createdAt: this.now() };
    b.set(seriesId, row);
    return row;
  }
  async removeSaved(userId: string, seriesId: string): Promise<boolean> {
    return this.bucket(this.saved, userId).delete(seriesId);
  }

  // ---- favorites
  private favKey(t: TargetType, id: string): string {
    return `${t}:${id}`;
  }
  async listFavorites(userId: string): Promise<FavoriteRow[]> {
    return [...this.bucket(this.favorites, userId).values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }
  async addFavorite(userId: string, targetType: TargetType, targetId: string): Promise<FavoriteRow> {
    const b = this.bucket(this.favorites, userId);
    const k = this.favKey(targetType, targetId);
    const existing = b.get(k);
    if (existing) return existing;
    const row: FavoriteRow = { targetType, targetId, createdAt: this.now() };
    b.set(k, row);
    return row;
  }
  async removeFavorite(userId: string, targetType: TargetType, targetId: string): Promise<boolean> {
    return this.bucket(this.favorites, userId).delete(this.favKey(targetType, targetId));
  }

  // ---- downloads
  async listDownloads(userId: string): Promise<DownloadRow[]> {
    return [...this.bucket(this.downloads, userId).values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }
  async addDownload(userId: string, seriesId: string, episodeIds: string[]): Promise<DownloadRow> {
    const b = this.bucket(this.downloads, userId);
    const existing = b.get(seriesId);
    if (existing) {
      // idempotent per series: merge episode set, reset to requested, keep createdAt
      existing.episodeIds = episodeIds;
      existing.status = "requested";
      return existing;
    }
    const row: StoredDownload = {
      seriesId,
      episodeIds,
      bytes: 0,
      status: "requested",
      createdAt: this.now(),
    };
    b.set(seriesId, row);
    return row;
  }
  async setDownloadStatus(
    userId: string,
    seriesId: string,
    status: DownloadStatus
  ): Promise<DownloadRow | null> {
    const row = this.bucket(this.downloads, userId).get(seriesId);
    if (row == null) return null;
    row.status = status;
    return row;
  }

  // ---- channel follows
  async listChannelFollows(userId: string): Promise<ChannelFollowRow[]> {
    return [...this.bucket(this.follows, userId).values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }
  async addChannelFollow(userId: string, channelId: string, notify: boolean): Promise<ChannelFollowRow> {
    const b = this.bucket(this.follows, userId);
    const existing = b.get(channelId);
    if (existing) {
      existing.notify = notify; // upsert the flag
      return existing;
    }
    const row: ChannelFollowRow = { channelId, notify, createdAt: this.now() };
    b.set(channelId, row);
    return row;
  }
  async removeChannelFollow(userId: string, channelId: string): Promise<boolean> {
    return this.bucket(this.follows, userId).delete(channelId);
  }

  // ---- history
  seedHistory(e: SeedHistoryEvent): void {
    this.history.push(e);
  }
  async listHistory(userId: string, limit: number): Promise<HistoryRow[]> {
    return this.history
      .filter((e) => e.userId === userId && (e.event === "play" || e.event === "episode_completed"))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit)
      .map((e) => ({
        seriesId: e.seriesId,
        seriesTitle: e.seriesTitle,
        event: e.event,
        occurredAt: e.occurredAt,
      }));
  }
}
