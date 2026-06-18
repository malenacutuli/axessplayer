// Production LibraryDB over node-postgres. The pure handlers depend only on the LibraryDB interface; this
// is the real adapter against the additive mobile tables (saved, favorites, downloads, channel_follows)
// and the read of engagement_events for history. It NEVER alters the schema and never reads a user id from
// anywhere but the userId argument the handler passes through from the verified session subject.
//
// search_path: the production pool is opened with `options=-c search_path=mobile,public` (see server.ts /
// DB_OPTIONS) so the unqualified table names below resolve to the isolated mobile schema. The SQL stays
// schema-agnostic. No em dashes.
//
// Idempotency: saved/favorites/channel_follows use INSERT ... ON CONFLICT; downloads upserts the intent.
// Every statement carries user_id in the WHERE/VALUES so a row can only ever be the subject's own.

import type pg from "pg";
import type {
  LibraryDB,
  SavedRow,
  FavoriteRow,
  DownloadRow,
  ChannelFollowRow,
  HistoryRow,
  TargetType,
  DownloadStatus,
} from "./library.js";

type Q = Pick<pg.Pool, "query">;

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v);

export class PgLibraryDb implements LibraryDB {
  constructor(private readonly db: Q) {}

  // ---- saved
  async listSaved(userId: string): Promise<SavedRow[]> {
    const r = await this.db.query(
      "select series_id, created_at from saved where user_id = $1 order by created_at desc, series_id",
      [userId]
    );
    return r.rows.map((row) => ({ seriesId: row.series_id as string, createdAt: iso(row.created_at) }));
  }

  async addSaved(userId: string, seriesId: string): Promise<SavedRow> {
    const r = await this.db.query(
      `insert into saved (user_id, series_id)
       values ($1, $2)
       on conflict (user_id, series_id) do update set series_id = excluded.series_id
       returning series_id, created_at`,
      [userId, seriesId]
    );
    const row = r.rows[0];
    return { seriesId: row.series_id as string, createdAt: iso(row.created_at) };
  }

  async removeSaved(userId: string, seriesId: string): Promise<boolean> {
    const r = await this.db.query(
      "delete from saved where user_id = $1 and series_id = $2 returning series_id",
      [userId, seriesId]
    );
    return (r.rowCount ?? r.rows.length) > 0;
  }

  // ---- favorites
  async listFavorites(userId: string): Promise<FavoriteRow[]> {
    const r = await this.db.query(
      `select target_type, target_id, created_at
         from favorites where user_id = $1
        order by created_at desc, target_id`,
      [userId]
    );
    return r.rows.map((row) => ({
      targetType: row.target_type as TargetType,
      targetId: row.target_id as string,
      createdAt: iso(row.created_at),
    }));
  }

  async addFavorite(userId: string, targetType: TargetType, targetId: string): Promise<FavoriteRow> {
    const r = await this.db.query(
      `insert into favorites (user_id, target_type, target_id)
       values ($1, $2, $3)
       on conflict (user_id, target_type, target_id) do update set target_id = excluded.target_id
       returning target_type, target_id, created_at`,
      [userId, targetType, targetId]
    );
    const row = r.rows[0];
    return {
      targetType: row.target_type as TargetType,
      targetId: row.target_id as string,
      createdAt: iso(row.created_at),
    };
  }

  async removeFavorite(userId: string, targetType: TargetType, targetId: string): Promise<boolean> {
    const r = await this.db.query(
      `delete from favorites
        where user_id = $1 and target_type = $2 and target_id = $3
        returning target_id`,
      [userId, targetType, targetId]
    );
    return (r.rowCount ?? r.rows.length) > 0;
  }

  // ---- downloads
  async listDownloads(userId: string): Promise<DownloadRow[]> {
    const r = await this.db.query(
      `select series_id, episode_ids, bytes, status, created_at
         from downloads where user_id = $1
        order by created_at desc, series_id`,
      [userId]
    );
    return r.rows.map(mapDownload);
  }

  async addDownload(userId: string, seriesId: string, episodeIds: string[]): Promise<DownloadRow> {
    // Records intent at status='requested'. On a repeat request for the same series we merge the episode
    // set and reset to 'requested' (idempotent per (user_id, series_id)). bytes starts at 0; the actual
    // transfer (and any byte accounting) is a client concern reported back via PATCH.
    const r = await this.db.query(
      `insert into downloads (user_id, series_id, episode_ids, bytes, status)
       values ($1, $2, $3, 0, 'requested')
       on conflict (user_id, series_id) do update
         set episode_ids = excluded.episode_ids,
             status = 'requested'
       returning series_id, episode_ids, bytes, status, created_at`,
      [userId, seriesId, episodeIds]
    );
    return mapDownload(r.rows[0]);
  }

  async setDownloadStatus(
    userId: string,
    seriesId: string,
    status: DownloadStatus
  ): Promise<DownloadRow | null> {
    const r = await this.db.query(
      `update downloads set status = $3
        where user_id = $1 and series_id = $2
        returning series_id, episode_ids, bytes, status, created_at`,
      [userId, seriesId, status]
    );
    return r.rows[0] ? mapDownload(r.rows[0]) : null;
  }

  // ---- channel follows
  async listChannelFollows(userId: string): Promise<ChannelFollowRow[]> {
    const r = await this.db.query(
      `select channel_id, notify, created_at
         from channel_follows where user_id = $1
        order by created_at desc, channel_id`,
      [userId]
    );
    return r.rows.map((row) => ({
      channelId: row.channel_id as string,
      notify: Boolean(row.notify),
      createdAt: iso(row.created_at),
    }));
  }

  async addChannelFollow(userId: string, channelId: string, notify: boolean): Promise<ChannelFollowRow> {
    const r = await this.db.query(
      `insert into channel_follows (user_id, channel_id, notify)
       values ($1, $2, $3)
       on conflict (user_id, channel_id) do update set notify = excluded.notify
       returning channel_id, notify, created_at`,
      [userId, channelId, notify]
    );
    const row = r.rows[0];
    return { channelId: row.channel_id as string, notify: Boolean(row.notify), createdAt: iso(row.created_at) };
  }

  async removeChannelFollow(userId: string, channelId: string): Promise<boolean> {
    const r = await this.db.query(
      "delete from channel_follows where user_id = $1 and channel_id = $2 returning channel_id",
      [userId, channelId]
    );
    return (r.rowCount ?? r.rows.length) > 0;
  }

  // ---- history (read of engagement_events for the subject)
  async listHistory(userId: string, limit: number): Promise<HistoryRow[]> {
    // Recent watch events (play / episode_completed) for the subject, joined to series for the title. The
    // join is left so an event referencing a since-removed series still appears. series_id is read from the
    // event payload (jsonb) which the client emits.
    const r = await this.db.query(
      `select e.event,
              e.created_at,
              (e.payload->>'series_id') as series_id,
              s.title as series_title
         from engagement_events e
         left join series s on s.id = (e.payload->>'series_id')::uuid
        where e.user_id = $1
          and e.event in ('play', 'episode_completed')
        order by e.created_at desc
        limit $2`,
      [userId, limit]
    );
    return r.rows.map((row) => ({
      seriesId: (row.series_id as string) ?? "",
      seriesTitle: (row.series_title as string) ?? null,
      event: row.event as string,
      occurredAt: iso(row.created_at),
    }));
  }
}

function mapDownload(row: Record<string, unknown>): DownloadRow {
  return {
    seriesId: row.series_id as string,
    episodeIds: (row.episode_ids as string[]) ?? [],
    bytes: Number(row.bytes ?? 0),
    status: row.status as DownloadStatus,
    createdAt: iso(row.created_at),
  };
}
