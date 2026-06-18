// The identity service's data port and its Postgres implementation. The port keeps the HTTP adapter and
// the linking logic testable (tests inject a fake); production injects PgIdentityDb over a node-postgres
// Pool with search_path=mobile,public so unqualified names resolve to the isolated `mobile` schema.
//
// SCHEMA ASSUMPTIONS (provided by the SQL slice, NOT created here): mobile.users carries the additive
// columns auth_id, username, avatar_url, tier, created_at alongside the base id/email. This service NEVER
// runs DDL/DML against the schema definition and NEVER writes a migration. It reads and writes ROWS only.
// viewer_state(user_id, series_id, preference_vector, ...) and channel_follows(...) already exist.
// No em dashes.

import type pg from "pg";

// A linked/created Axessplayer profile. complete is true when the viewer has chosen a username (the
// onboarding "create profile" step is done); a freshly linked auth user is incomplete until then.
export interface ProfileRow {
  id: string;
  email: string;
  authId: string | null;
  username: string | null;
  avatarUrl: string | null;
  tier: string | null;
}

export interface ProfileUpdate {
  username: string;
  avatarUrl: string | null;
}

export interface IdentityDb {
  // Link an existing mobile.users row by auth_id, or create one. Idempotent on auth_id, then falls back to
  // email so a pre-existing email-only row is adopted rather than duplicated. Returns the linked profile.
  linkOrCreateByAuthId(authId: string, email: string): Promise<ProfileRow>;
  // Case-insensitive availability of a (normalized) username, optionally excluding the caller's own row so
  // re-saving an unchanged handle is not reported as taken.
  usernameAvailable(normalizedUsername: string, excludeUserId?: string): Promise<boolean>;
  // The session subject's profile, or null if the row is gone.
  findById(userId: string): Promise<ProfileRow | null>;
  // Persist the profile fields. Returns the updated profile.
  updateProfile(userId: string, update: ProfileUpdate): Promise<ProfileRow>;
  // Seed the viewer's preference vector for a series (onboarding picks). Upsert on (user_id, series_id).
  seedPreferenceVector(userId: string, seriesId: string, vector: Record<string, number>): Promise<void>;
  // Follow a channel (onboarding picks). Idempotent.
  followChannel(userId: string, channelId: string): Promise<void>;
}

const SELECT_COLS =
  "id, email, auth_id, username, avatar_url, tier";

function toProfile(row: Record<string, unknown>): ProfileRow {
  return {
    id: row.id as string,
    email: row.email as string,
    authId: (row.auth_id as string | null) ?? null,
    username: (row.username as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    tier: (row.tier as string | null) ?? null,
  };
}

// A profile is complete once a username is chosen. Kept here so the route and tests share one definition.
export function isProfileComplete(p: ProfileRow): boolean {
  return typeof p.username === "string" && p.username.length > 0;
}

export class PgIdentityDb implements IdentityDb {
  constructor(private readonly db: Pick<pg.Pool, "query">) {}

  async linkOrCreateByAuthId(authId: string, email: string): Promise<ProfileRow> {
    // 1. Already linked by auth_id.
    const byAuth = await this.db.query(
      `select ${SELECT_COLS} from users where auth_id = $1`,
      [authId],
    );
    if (byAuth.rows.length > 0) return toProfile(byAuth.rows[0]);

    // 2. Adopt a pre-existing email-only row (set its auth_id). email is UNIQUE in the base schema.
    const adopted = await this.db.query(
      `update users set auth_id = $1
         where email = $2 and auth_id is null
       returning ${SELECT_COLS}`,
      [authId, email],
    );
    if (adopted.rows.length > 0) return toProfile(adopted.rows[0]);

    // 3. Create a fresh row. ON CONFLICT handles the race where two requests link the same auth_id/email
    // concurrently; the conflicting insert resolves to the existing row.
    const created = await this.db.query(
      `insert into users (email, auth_id)
         values ($2, $1)
       on conflict (email) do update set auth_id = coalesce(users.auth_id, excluded.auth_id)
       returning ${SELECT_COLS}`,
      [authId, email],
    );
    return toProfile(created.rows[0]);
  }

  async usernameAvailable(normalizedUsername: string, excludeUserId?: string): Promise<boolean> {
    const params: unknown[] = [normalizedUsername];
    let sql = "select 1 from users where lower(username) = $1";
    if (excludeUserId != null) {
      params.push(excludeUserId);
      sql += " and id <> $2";
    }
    sql += " limit 1";
    const r = await this.db.query(sql, params);
    return r.rows.length === 0;
  }

  async findById(userId: string): Promise<ProfileRow | null> {
    const r = await this.db.query(`select ${SELECT_COLS} from users where id = $1`, [userId]);
    return r.rows.length > 0 ? toProfile(r.rows[0]) : null;
  }

  async updateProfile(userId: string, update: ProfileUpdate): Promise<ProfileRow> {
    const r = await this.db.query(
      `update users set username = $2, avatar_url = $3
         where id = $1
       returning ${SELECT_COLS}`,
      [userId, update.username, update.avatarUrl],
    );
    if (r.rows.length === 0) throw new Error("unknown_user");
    return toProfile(r.rows[0]);
  }

  async seedPreferenceVector(
    userId: string,
    seriesId: string,
    vector: Record<string, number>,
  ): Promise<void> {
    await this.db.query(
      `insert into viewer_state (user_id, series_id, preference_vector)
         values ($1, $2, $3)
       on conflict (user_id, series_id)
         do update set preference_vector = excluded.preference_vector, updated_at = now()`,
      [userId, seriesId, JSON.stringify(vector)],
    );
  }

  async followChannel(userId: string, channelId: string): Promise<void> {
    // channel_follows shape is owned by the SQL slice; the (user_id, channel_id) pair is the natural key.
    // ON CONFLICT DO NOTHING makes the follow idempotent without assuming a constraint name.
    await this.db.query(
      `insert into channel_follows (user_id, channel_id)
         values ($1, $2)
       on conflict do nothing`,
      [userId, channelId],
    );
  }
}
