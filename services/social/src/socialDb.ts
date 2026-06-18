// The social service's data port and its Postgres + in-memory implementations. The port keeps the HTTP
// adapter and the gate logic testable (tests inject the in-memory fake); production injects PgSocialDb over
// a node-postgres Pool with search_path=mobile,public so unqualified names resolve to the `mobile` schema.
//
// SCHEMA ASSUMPTIONS (provided by scripts/sql/14_social.sql, NOT created here): the tables
// character_follows, posts, comments, likes, reports, blocks, mutes exist on the mobile schema. This
// service NEVER runs DDL and NEVER writes a migration; it reads and writes ROWS only.
//
// FAIL-CLOSED VISIBILITY: read paths (feed, comment thread) return ONLY rows with
// moderation_status = 'approved' and deleted_at is null. A pending / pending_provider / rejected row is
// invisible to viewers; it is reachable only by the moderation queue read. No em dashes.

import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { ModerationStatus, UgcKind } from "./moderation.js";

export interface PostRow {
  id: string;
  characterId: string;
  authorUserId: string;
  body: string;
  mediaUrl: string | null;
  mature: boolean;
  moderationStatus: ModerationStatus;
  createdAt: string;
}

export interface CommentRow {
  id: string;
  showId: string;
  parentCommentId: string | null;
  authorUserId: string;
  body: string;
  moderationStatus: ModerationStatus;
  likeCount: number;
  createdAt: string;
}

export interface NewPost {
  characterId: string;
  authorUserId: string;
  body: string;
  mediaUrl: string | null;
  mature: boolean;
  moderationStatus: ModerationStatus;
}

export interface NewComment {
  showId: string;
  parentCommentId: string | null;
  authorUserId: string;
  body: string;
  moderationStatus: ModerationStatus;
}

export interface NewReport {
  reporterId: string;
  subjectKind: UgcKind;
  subjectId: string;
  reason: string;
}

export type CommentSort = "newest" | "top";

export interface ModerationQueueItem {
  id: string;
  kind: UgcKind;
  authorUserId: string;
  moderationStatus: ModerationStatus;
  createdAt: string;
}

export interface SocialDb {
  followCharacter(userId: string, characterId: string): Promise<void>;
  insertPost(post: NewPost): Promise<PostRow>;
  insertComment(comment: NewComment): Promise<CommentRow>;
  // Feed of APPROVED, non-deleted posts for a character, newest first.
  feedForCharacter(characterId: string, viewerId: string): Promise<PostRow[]>;
  // APPROVED, non-deleted comments on a show, threaded (parents then their replies), sorted per `sort`.
  commentsForShow(showId: string, viewerId: string, sort: CommentSort): Promise<CommentRow[]>;
  // Idempotent like on a post/comment; maintains the denormalized comment like_count. Returns true if a
  // new like row was created (false when it already existed).
  like(userId: string, kind: UgcKind, subjectId: string): Promise<boolean>;
  insertReport(report: NewReport): Promise<{ id: string }>;
  block(blockerId: string, blockedId: string): Promise<void>;
  mute(muterId: string, mutedId: string): Promise<void>;
  // The moderation queue read: pending / pending_provider items oldest-first across posts and comments.
  moderationQueue(): Promise<ModerationQueueItem[]>;
}

// In-memory SocialDb for tests and local dev. Enforces the same fail-closed visibility and block/mute
// filtering as the Pg implementation.
export class InMemorySocialDb implements SocialDb {
  private follows: Array<{ userId: string; characterId: string }> = [];
  private posts: PostRow[] = [];
  private comments: CommentRow[] = [];
  private likes = new Set<string>();
  private reports: Array<NewReport & { id: string }> = [];
  private blocks = new Set<string>();
  private mutes = new Set<string>();
  // Monotonic clock so rows inserted in the same wall-clock millisecond still get a stable, increasing
  // createdAt (the feed/thread ordering depends on it). Mirrors Postgres rows always differing in order.
  private clock = 0;

  // Real UUIDs, matching the gen_random_uuid() column defaults in 14_social.sql, so a fake row's id passes
  // the same UUID validation the route applies to subject_id / parent_comment_id.
  private nextId(): string {
    return randomUUID();
  }

  private nextCreatedAt(): string {
    this.clock += 1;
    return new Date(this.clock).toISOString();
  }

  async followCharacter(userId: string, characterId: string): Promise<void> {
    if (!this.follows.some((f) => f.userId === userId && f.characterId === characterId)) {
      this.follows.push({ userId, characterId });
    }
  }

  async insertPost(p: NewPost): Promise<PostRow> {
    const row: PostRow = {
      id: this.nextId(),
      characterId: p.characterId,
      authorUserId: p.authorUserId,
      body: p.body,
      mediaUrl: p.mediaUrl,
      mature: p.mature,
      moderationStatus: p.moderationStatus,
      createdAt: this.nextCreatedAt(),
    };
    this.posts.push(row);
    return row;
  }

  async insertComment(c: NewComment): Promise<CommentRow> {
    const row: CommentRow = {
      id: this.nextId(),
      showId: c.showId,
      parentCommentId: c.parentCommentId,
      authorUserId: c.authorUserId,
      body: c.body,
      moderationStatus: c.moderationStatus,
      likeCount: 0,
      createdAt: this.nextCreatedAt(),
    };
    this.comments.push(row);
    return row;
  }

  // True when the viewer has blocked or muted the author (author content is hidden from the viewer).
  private hidden(viewerId: string, authorId: string): boolean {
    return this.blocks.has(`${viewerId}:${authorId}`) || this.mutes.has(`${viewerId}:${authorId}`);
  }

  async feedForCharacter(characterId: string, viewerId: string): Promise<PostRow[]> {
    return this.posts
      .filter((p) => p.characterId === characterId)
      .filter((p) => p.moderationStatus === "approved")
      .filter((p) => !this.hidden(viewerId, p.authorUserId))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  async commentsForShow(
    showId: string,
    viewerId: string,
    sort: CommentSort,
  ): Promise<CommentRow[]> {
    const visible = this.comments
      .filter((c) => c.showId === showId)
      .filter((c) => c.moderationStatus === "approved")
      .filter((c) => !this.hidden(viewerId, c.authorUserId));

    const order = (a: CommentRow, b: CommentRow): number => {
      if (sort === "top" && a.likeCount !== b.likeCount) return b.likeCount - a.likeCount;
      return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
    };

    // Thread: top-level comments per `order`, each followed by its replies (oldest-first within a thread).
    const tops = visible.filter((c) => c.parentCommentId == null).sort(order);
    const out: CommentRow[] = [];
    for (const top of tops) {
      out.push(top);
      const replies = visible
        .filter((c) => c.parentCommentId === top.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
      out.push(...replies);
    }
    return out;
  }

  async like(userId: string, kind: UgcKind, subjectId: string): Promise<boolean> {
    const key = `${userId}:${kind}:${subjectId}`;
    if (this.likes.has(key)) return false;
    this.likes.add(key);
    if (kind === "comment") {
      const c = this.comments.find((x) => x.id === subjectId);
      if (c != null) c.likeCount += 1;
    }
    return true;
  }

  async insertReport(r: NewReport): Promise<{ id: string }> {
    const id = this.nextId();
    this.reports.push({ ...r, id });
    return { id };
  }

  async block(blockerId: string, blockedId: string): Promise<void> {
    this.blocks.add(`${blockerId}:${blockedId}`);
  }

  async mute(muterId: string, mutedId: string): Promise<void> {
    this.mutes.add(`${muterId}:${mutedId}`);
  }

  async moderationQueue(): Promise<ModerationQueueItem[]> {
    const items: ModerationQueueItem[] = [
      ...this.posts
        .filter((p) => p.moderationStatus === "pending" || p.moderationStatus === "pending_provider")
        .map((p) => ({
          id: p.id,
          kind: "post" as UgcKind,
          authorUserId: p.authorUserId,
          moderationStatus: p.moderationStatus,
          createdAt: p.createdAt,
        })),
      ...this.comments
        .filter((c) => c.moderationStatus === "pending" || c.moderationStatus === "pending_provider")
        .map((c) => ({
          id: c.id,
          kind: "comment" as UgcKind,
          authorUserId: c.authorUserId,
          moderationStatus: c.moderationStatus,
          createdAt: c.createdAt,
        })),
    ];
    return items.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  // Test/inspection helpers (not part of the port).
  allReports(): ReadonlyArray<NewReport & { id: string }> {
    return this.reports;
  }
}

// Postgres implementation over a node-postgres Pool. search_path=mobile,public resolves the unqualified
// table names. Read paths enforce fail-closed visibility in SQL.
export class PgSocialDb implements SocialDb {
  constructor(private readonly db: Pick<pg.Pool, "query">) {}

  async followCharacter(userId: string, characterId: string): Promise<void> {
    await this.db.query(
      `insert into character_follows (user_id, character_id)
         values ($1, $2)
       on conflict do nothing`,
      [userId, characterId],
    );
  }

  async insertPost(p: NewPost): Promise<PostRow> {
    const r = await this.db.query(
      `insert into posts (character_id, author_user_id, body, media_url, mature, moderation_status)
         values ($1, $2, $3, $4, $5, $6)
       returning id, character_id, author_user_id, body, media_url, mature, moderation_status, created_at`,
      [p.characterId, p.authorUserId, p.body, p.mediaUrl, p.mature, p.moderationStatus],
    );
    return toPost(r.rows[0]);
  }

  async insertComment(c: NewComment): Promise<CommentRow> {
    const r = await this.db.query(
      `insert into comments (show_id, parent_comment_id, author_user_id, body, moderation_status)
         values ($1, $2, $3, $4, $5)
       returning id, show_id, parent_comment_id, author_user_id, body, moderation_status, like_count, created_at`,
      [c.showId, c.parentCommentId, c.authorUserId, c.body, c.moderationStatus],
    );
    return toComment(r.rows[0]);
  }

  async feedForCharacter(characterId: string, viewerId: string): Promise<PostRow[]> {
    // Fail-closed visibility: approved + not deleted only. Exclude authors the viewer blocked or muted.
    const r = await this.db.query(
      `select id, character_id, author_user_id, body, media_url, mature, moderation_status, created_at
         from posts
        where character_id = $1
          and moderation_status = 'approved'
          and deleted_at is null
          and author_user_id not in (select blocked_id from blocks where blocker_id = $2)
          and author_user_id not in (select muted_id from mutes where muter_id = $2)
        order by created_at desc`,
      [characterId, viewerId],
    );
    return r.rows.map(toPost);
  }

  async commentsForShow(
    showId: string,
    viewerId: string,
    sort: CommentSort,
  ): Promise<CommentRow[]> {
    const orderBy = sort === "top" ? "like_count desc, created_at desc" : "created_at desc";
    // Threaded read: order top-level comments per `sort`, append each comment's replies oldest-first. Done
    // with a window over the visible set so a single query returns the threaded order. Fail-closed
    // visibility applies to both parents and replies.
    const r = await this.db.query(
      `with visible as (
         select id, show_id, parent_comment_id, author_user_id, body, moderation_status, like_count, created_at
           from comments
          where show_id = $1
            and moderation_status = 'approved'
            and deleted_at is null
            and author_user_id not in (select blocked_id from blocks where blocker_id = $2)
            and author_user_id not in (select muted_id from mutes where muter_id = $2)
       ),
       tops as (
         select *, row_number() over (order by ${orderBy}) as thread_rank
           from visible where parent_comment_id is null
       )
       select v.id, v.show_id, v.parent_comment_id, v.author_user_id, v.body,
              v.moderation_status, v.like_count, v.created_at
         from visible v
         join tops t on t.id = coalesce(v.parent_comment_id, v.id)
        order by t.thread_rank asc,
                 case when v.parent_comment_id is null then 0 else 1 end asc,
                 v.created_at asc`,
      [showId, viewerId],
    );
    return r.rows.map(toComment);
  }

  async like(userId: string, kind: UgcKind, subjectId: string): Promise<boolean> {
    const ins = await this.db.query(
      `insert into likes (user_id, subject_kind, subject_id)
         values ($1, $2, $3)
       on conflict do nothing
       returning user_id`,
      [userId, kind, subjectId],
    );
    const created = ins.rows.length > 0;
    if (created && kind === "comment") {
      await this.db.query(`update comments set like_count = like_count + 1 where id = $1`, [
        subjectId,
      ]);
    }
    return created;
  }

  async insertReport(r: NewReport): Promise<{ id: string }> {
    const res = await this.db.query(
      `insert into reports (reporter_id, subject_kind, subject_id, reason)
         values ($1, $2, $3, $4)
       returning id`,
      [r.reporterId, r.subjectKind, r.subjectId, r.reason],
    );
    return { id: res.rows[0].id as string };
  }

  async block(blockerId: string, blockedId: string): Promise<void> {
    await this.db.query(
      `insert into blocks (blocker_id, blocked_id) values ($1, $2) on conflict do nothing`,
      [blockerId, blockedId],
    );
  }

  async mute(muterId: string, mutedId: string): Promise<void> {
    await this.db.query(
      `insert into mutes (muter_id, muted_id) values ($1, $2) on conflict do nothing`,
      [muterId, mutedId],
    );
  }

  async moderationQueue(): Promise<ModerationQueueItem[]> {
    const r = await this.db.query(
      `select id, 'post' as kind, author_user_id, moderation_status, created_at
         from posts
        where moderation_status in ('pending', 'pending_provider')
       union all
       select id, 'comment' as kind, author_user_id, moderation_status, created_at
         from comments
        where moderation_status in ('pending', 'pending_provider')
       order by created_at asc`,
    );
    return r.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      kind: row.kind as UgcKind,
      authorUserId: row.author_user_id as string,
      moderationStatus: row.moderation_status as ModerationStatus,
      createdAt: String(row.created_at),
    }));
  }
}

function toPost(row: Record<string, unknown>): PostRow {
  return {
    id: row.id as string,
    characterId: row.character_id as string,
    authorUserId: row.author_user_id as string,
    body: row.body as string,
    mediaUrl: (row.media_url as string | null) ?? null,
    mature: row.mature === true,
    moderationStatus: row.moderation_status as ModerationStatus,
    createdAt: String(row.created_at),
  };
}

function toComment(row: Record<string, unknown>): CommentRow {
  return {
    id: row.id as string,
    showId: row.show_id as string,
    parentCommentId: (row.parent_comment_id as string | null) ?? null,
    authorUserId: row.author_user_id as string,
    body: row.body as string,
    moderationStatus: row.moderation_status as ModerationStatus,
    likeCount: Number(row.like_count ?? 0),
    createdAt: String(row.created_at),
  };
}
