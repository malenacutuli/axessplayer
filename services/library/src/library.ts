// Pure library handlers. These own the LIBRARY API CONTRACT logic and nothing about transport. Each
// handler takes the VERIFIED session user id (resolved at the HTTP edge from the bearer token, never a
// body field) plus a LibraryDB port, and returns a status + JSON body. The handlers are deliberately free
// of Hono, node:http, and pg so they can be unit-tested with a fake pg-backed LibraryDB and asserted for
// ownership scoping and idempotency.
//
// Trust boundary (F1): the userId argument is the authenticated subject. Every read and write is scoped to
// it. A handler NEVER reads a user id out of the request body. A user therefore cannot read or mutate
// another user's saved / favorites / downloads / channel-follows rows: the WHERE/INSERT always pins
// user_id to the verified subject.
//
// Idempotency: POSTs are INSERT ... ON CONFLICT DO NOTHING (saved, favorites, channel_follows) or upsert
// (channel_follows notify, downloads status); a repeated POST is a no-op that still returns 200/201 with
// the current row. No em dashes.

export type TargetType = "show" | "character";
export type DownloadStatus = "requested" | "downloading" | "ready" | "failed" | "removed";

const DOWNLOAD_STATUSES: readonly DownloadStatus[] = [
  "requested",
  "downloading",
  "ready",
  "failed",
  "removed",
];

export interface SavedRow {
  seriesId: string;
  createdAt: string;
}

export interface FavoriteRow {
  targetType: TargetType;
  targetId: string;
  createdAt: string;
}

export interface DownloadRow {
  seriesId: string;
  episodeIds: string[];
  bytes: number;
  status: DownloadStatus;
  createdAt: string;
}

export interface ChannelFollowRow {
  channelId: string;
  notify: boolean;
  createdAt: string;
}

export interface HistoryRow {
  seriesId: string;
  seriesTitle: string | null;
  event: string;
  occurredAt: string;
}

// The data port. All methods are scoped by the verified user id (the first argument), so the SQL behind
// them always pins user_id to the subject. The production adapter (pgLibraryDb.ts) implements this over
// node-postgres against the additive mobile tables; tests implement it over a fake pg.
export interface LibraryDB {
  // saved
  listSaved(userId: string): Promise<SavedRow[]>;
  addSaved(userId: string, seriesId: string): Promise<SavedRow>;
  removeSaved(userId: string, seriesId: string): Promise<boolean>;

  // favorites
  listFavorites(userId: string): Promise<FavoriteRow[]>;
  addFavorite(userId: string, targetType: TargetType, targetId: string): Promise<FavoriteRow>;
  removeFavorite(userId: string, targetType: TargetType, targetId: string): Promise<boolean>;

  // downloads
  listDownloads(userId: string): Promise<DownloadRow[]>;
  addDownload(userId: string, seriesId: string, episodeIds: string[]): Promise<DownloadRow>;
  setDownloadStatus(userId: string, seriesId: string, status: DownloadStatus): Promise<DownloadRow | null>;

  // channel follows
  listChannelFollows(userId: string): Promise<ChannelFollowRow[]>;
  addChannelFollow(userId: string, channelId: string, notify: boolean): Promise<ChannelFollowRow>;
  removeChannelFollow(userId: string, channelId: string): Promise<boolean>;

  // history (read from engagement_events)
  listHistory(userId: string, limit: number): Promise<HistoryRow[]>;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

const ok = (body: unknown): HandlerResult => ({ status: 200, body });
const created = (body: unknown): HandlerResult => ({ status: 201, body });
const noContent = (): HandlerResult => ({ status: 204, body: null });
const badRequest = (error: string): HandlerResult => ({ status: 400, body: { error } });
const notFound = (error: string): HandlerResult => ({ status: 404, body: { error } });

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// ---------------------------------------------------------------------------------------------- saved

export async function handleListSaved(userId: string, db: LibraryDB): Promise<HandlerResult> {
  return ok({ saved: await db.listSaved(userId) });
}

export async function handleAddSaved(
  userId: string,
  body: unknown,
  db: LibraryDB
): Promise<HandlerResult> {
  const seriesId = (body as { seriesId?: unknown } | null)?.seriesId;
  if (!isNonEmptyString(seriesId)) return badRequest("seriesId is required");
  // Idempotent: a repeated save returns the existing row, status 201 either way.
  return created({ saved: await db.addSaved(userId, seriesId) });
}

export async function handleRemoveSaved(
  userId: string,
  seriesId: string,
  db: LibraryDB
): Promise<HandlerResult> {
  if (!isNonEmptyString(seriesId)) return badRequest("seriesId is required");
  // Removing a row that does not exist (or belongs to nobody we can see) is a 204 no-op: the desired
  // post-state (not saved) holds. Ownership scoping means another user's row is never touched.
  await db.removeSaved(userId, seriesId);
  return noContent();
}

// ------------------------------------------------------------------------------------------- favorites

export async function handleListFavorites(userId: string, db: LibraryDB): Promise<HandlerResult> {
  return ok({ favorites: await db.listFavorites(userId) });
}

function parseTargetType(v: unknown): TargetType | null {
  return v === "show" || v === "character" ? v : null;
}

export async function handleAddFavorite(
  userId: string,
  body: unknown,
  db: LibraryDB
): Promise<HandlerResult> {
  const b = (body as { targetType?: unknown; targetId?: unknown } | null) ?? {};
  const targetType = parseTargetType(b.targetType);
  if (targetType == null) return badRequest("targetType must be 'show' or 'character'");
  if (!isNonEmptyString(b.targetId)) return badRequest("targetId is required");
  return created({ favorite: await db.addFavorite(userId, targetType, b.targetId) });
}

export async function handleRemoveFavorite(
  userId: string,
  body: unknown,
  db: LibraryDB
): Promise<HandlerResult> {
  const b = (body as { targetType?: unknown; targetId?: unknown } | null) ?? {};
  const targetType = parseTargetType(b.targetType);
  if (targetType == null) return badRequest("targetType must be 'show' or 'character'");
  if (!isNonEmptyString(b.targetId)) return badRequest("targetId is required");
  await db.removeFavorite(userId, targetType, b.targetId);
  return noContent();
}

// ------------------------------------------------------------------------------------------- downloads

export async function handleListDownloads(userId: string, db: LibraryDB): Promise<HandlerResult> {
  return ok({ downloads: await db.listDownloads(userId) });
}

export async function handleAddDownload(
  userId: string,
  body: unknown,
  db: LibraryDB
): Promise<HandlerResult> {
  const b = (body as { seriesId?: unknown; episodeIds?: unknown } | null) ?? {};
  if (!isNonEmptyString(b.seriesId)) return badRequest("seriesId is required");
  if (
    !Array.isArray(b.episodeIds) ||
    b.episodeIds.length === 0 ||
    !b.episodeIds.every(isNonEmptyString)
  ) {
    return badRequest("episodeIds must be a non-empty array of strings");
  }
  // Records download intent at status='requested'. The actual file transfer is a client concern; the
  // service only tracks the request and its lifecycle status (advanced via PATCH). Idempotent per series.
  return created({ download: await db.addDownload(userId, b.seriesId, b.episodeIds as string[]) });
}

function parseStatus(v: unknown): DownloadStatus | null {
  return DOWNLOAD_STATUSES.includes(v as DownloadStatus) ? (v as DownloadStatus) : null;
}

export async function handlePatchDownload(
  userId: string,
  seriesId: string,
  body: unknown,
  db: LibraryDB
): Promise<HandlerResult> {
  if (!isNonEmptyString(seriesId)) return badRequest("seriesId is required");
  const status = parseStatus((body as { status?: unknown } | null)?.status);
  if (status == null) {
    return badRequest(`status must be one of ${DOWNLOAD_STATUSES.join(", ")}`);
  }
  // Ownership scoping: the update pins user_id to the subject, so a missing/foreign row updates nothing
  // and we answer 404 rather than silently touching another user's download.
  const row = await db.setDownloadStatus(userId, seriesId, status);
  if (row == null) return notFound("download not found");
  return ok({ download: row });
}

// -------------------------------------------------------------------------------------- channel follows

export async function handleListChannelFollows(userId: string, db: LibraryDB): Promise<HandlerResult> {
  return ok({ follows: await db.listChannelFollows(userId) });
}

export async function handleAddChannelFollow(
  userId: string,
  body: unknown,
  db: LibraryDB
): Promise<HandlerResult> {
  const b = (body as { channelId?: unknown; notify?: unknown } | null) ?? {};
  if (!isNonEmptyString(b.channelId)) return badRequest("channelId is required");
  // notify defaults to true when omitted; a non-boolean is rejected so the upsert never coerces garbage.
  let notify = true;
  if (b.notify !== undefined) {
    if (typeof b.notify !== "boolean") return badRequest("notify must be a boolean");
    notify = b.notify;
  }
  // Idempotent upsert: a repeat follow updates the notify flag and returns the row.
  return created({ follow: await db.addChannelFollow(userId, b.channelId, notify) });
}

export async function handleRemoveChannelFollow(
  userId: string,
  channelId: string,
  db: LibraryDB
): Promise<HandlerResult> {
  if (!isNonEmptyString(channelId)) return badRequest("channelId is required");
  await db.removeChannelFollow(userId, channelId);
  return noContent();
}

// --------------------------------------------------------------------------------------------- history

const HISTORY_DEFAULT_LIMIT = 50;
const HISTORY_MAX_LIMIT = 200;

export async function handleGetHistory(
  userId: string,
  rawLimit: string | null | undefined,
  db: LibraryDB
): Promise<HandlerResult> {
  let limit = HISTORY_DEFAULT_LIMIT;
  if (isNonEmptyString(rawLimit)) {
    const n = Number(rawLimit);
    if (!Number.isFinite(n) || n <= 0) return badRequest("limit must be a positive number");
    limit = Math.min(Math.floor(n), HISTORY_MAX_LIMIT);
  }
  return ok({ history: await db.listHistory(userId, limit) });
}
