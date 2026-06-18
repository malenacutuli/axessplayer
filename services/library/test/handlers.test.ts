// Pure-handler tests for the library service against the in-memory FakeLibraryDb. These prove the
// contract logic without transport: validation, idempotency, and (the load-bearing property) ownership
// scoping. A handler is always called with the VERIFIED session subject; we pass user A's id and user B's
// id explicitly to prove a handler scoped to A can never read or mutate B's rows. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeLibraryDb } from "./fakeDb.js";
import {
  handleListSaved,
  handleAddSaved,
  handleRemoveSaved,
  handleAddFavorite,
  handleRemoveFavorite,
  handleListFavorites,
  handleAddDownload,
  handlePatchDownload,
  handleListDownloads,
  handleAddChannelFollow,
  handleListChannelFollows,
  handleGetHistory,
} from "../src/library.js";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const SERIES = "11111111-1111-1111-1111-111111111111";
const SERIES2 = "11111111-1111-1111-1111-111111111122";

// ---------------- saved ----------------

test("saved: add then list returns the row; re-add is idempotent (one row, same createdAt)", async () => {
  const db = new FakeLibraryDb();
  const first = await handleAddSaved(A, { seriesId: SERIES }, db);
  assert.equal(first.status, 201);
  const again = await handleAddSaved(A, { seriesId: SERIES }, db);
  assert.equal(again.status, 201);
  const list = (await handleListSaved(A, db)).body as { saved: { seriesId: string; createdAt: string }[] };
  assert.equal(list.saved.length, 1);
  assert.equal(list.saved[0].seriesId, SERIES);
  // idempotent: the re-POST returned the same createdAt, not a fresh row
  assert.equal(
    (first.body as { saved: { createdAt: string } }).saved.createdAt,
    (again.body as { saved: { createdAt: string } }).saved.createdAt
  );
});

test("saved: missing seriesId is 400", async () => {
  const db = new FakeLibraryDb();
  assert.equal((await handleAddSaved(A, {}, db)).status, 400);
  assert.equal((await handleAddSaved(A, null, db)).status, 400);
});

test("saved: a user cannot see or remove another user's saved row (ownership scoping)", async () => {
  const db = new FakeLibraryDb();
  await handleAddSaved(A, { seriesId: SERIES }, db);
  // B's list is empty: B cannot see A's row
  assert.equal(((await handleListSaved(B, db)).body as { saved: unknown[] }).saved.length, 0);
  // B's delete of the same seriesId is a 204 no-op and leaves A's row intact
  assert.equal((await handleRemoveSaved(B, SERIES, db)).status, 204);
  assert.equal(((await handleListSaved(A, db)).body as { saved: unknown[] }).saved.length, 1);
  // A removing its own row works and leaves nothing
  assert.equal((await handleRemoveSaved(A, SERIES, db)).status, 204);
  assert.equal(((await handleListSaved(A, db)).body as { saved: unknown[] }).saved.length, 0);
});

// ---------------- favorites ----------------

test("favorites: validates targetType and targetId; add is idempotent on the composite key", async () => {
  const db = new FakeLibraryDb();
  assert.equal((await handleAddFavorite(A, { targetType: "bogus", targetId: "x" }, db)).status, 400);
  assert.equal((await handleAddFavorite(A, { targetType: "show" }, db)).status, 400);
  assert.equal((await handleAddFavorite(A, { targetType: "show", targetId: SERIES }, db)).status, 201);
  assert.equal((await handleAddFavorite(A, { targetType: "show", targetId: SERIES }, db)).status, 201);
  const list = (await handleListFavorites(A, db)).body as { favorites: unknown[] };
  assert.equal(list.favorites.length, 1);
});

test("favorites: ownership scoping on remove (B cannot delete A's favorite)", async () => {
  const db = new FakeLibraryDb();
  await handleAddFavorite(A, { targetType: "character", targetId: "char-1" }, db);
  assert.equal((await handleRemoveFavorite(B, { targetType: "character", targetId: "char-1" }, db)).status, 204);
  assert.equal(((await handleListFavorites(A, db)).body as { favorites: unknown[] }).favorites.length, 1);
});

// ---------------- downloads ----------------

test("downloads: POST records intent at status='requested'; re-POST is idempotent per series", async () => {
  const db = new FakeLibraryDb();
  const res = await handleAddDownload(A, { seriesId: SERIES, episodeIds: ["e1", "e2"] }, db);
  assert.equal(res.status, 201);
  assert.equal((res.body as { download: { status: string } }).download.status, "requested");
  await handleAddDownload(A, { seriesId: SERIES, episodeIds: ["e1", "e2", "e3"] }, db);
  const list = (await handleListDownloads(A, db)).body as { downloads: { seriesId: string; episodeIds: string[] }[] };
  assert.equal(list.downloads.length, 1, "re-POST same series does not create a second row");
  assert.deepEqual(list.downloads[0].episodeIds, ["e1", "e2", "e3"]);
});

test("downloads: POST requires a non-empty episodeIds array of strings", async () => {
  const db = new FakeLibraryDb();
  assert.equal((await handleAddDownload(A, { seriesId: SERIES, episodeIds: [] }, db)).status, 400);
  assert.equal((await handleAddDownload(A, { seriesId: SERIES, episodeIds: [1, 2] }, db)).status, 400);
  assert.equal((await handleAddDownload(A, { seriesId: SERIES }, db)).status, 400);
});

test("downloads: PATCH validates status; updates the owner's row; 404 for a missing/foreign row", async () => {
  const db = new FakeLibraryDb();
  await handleAddDownload(A, { seriesId: SERIES, episodeIds: ["e1"] }, db);
  assert.equal((await handlePatchDownload(A, SERIES, { status: "nope" }, db)).status, 400);
  const ok = await handlePatchDownload(A, SERIES, { status: "ready" }, db);
  assert.equal(ok.status, 200);
  assert.equal((ok.body as { download: { status: string } }).download.status, "ready");
  // B patching A's series is a 404: the update is scoped to B and matches nothing
  assert.equal((await handlePatchDownload(B, SERIES, { status: "removed" }, db)).status, 404);
  // A's row is untouched by B's attempt
  const list = (await handleListDownloads(A, db)).body as { downloads: { status: string }[] };
  assert.equal(list.downloads[0].status, "ready");
});

// ---------------- channel follows ----------------

test("channel-follows: notify defaults to true and a repeat follow upserts the flag", async () => {
  const db = new FakeLibraryDb();
  const first = await handleAddChannelFollow(A, { channelId: "ch-1" }, db);
  assert.equal((first.body as { follow: { notify: boolean } }).follow.notify, true);
  await handleAddChannelFollow(A, { channelId: "ch-1", notify: false }, db);
  const list = (await handleListChannelFollows(A, db)).body as { follows: { channelId: string; notify: boolean }[] };
  assert.equal(list.follows.length, 1);
  assert.equal(list.follows[0].notify, false);
});

test("channel-follows: a non-boolean notify is 400", async () => {
  const db = new FakeLibraryDb();
  assert.equal((await handleAddChannelFollow(A, { channelId: "ch-1", notify: "yes" }, db)).status, 400);
});

// ---------------- history ----------------

test("history: returns only the subject's play/episode_completed events, newest first, capped by limit", async () => {
  const db = new FakeLibraryDb();
  db.seedHistory({ userId: A, event: "play", seriesId: SERIES, seriesTitle: "S1", occurredAt: "2026-01-01T00:00:00.000Z" });
  db.seedHistory({ userId: A, event: "episode_completed", seriesId: SERIES2, seriesTitle: "S2", occurredAt: "2026-01-02T00:00:00.000Z" });
  // noise that must be excluded: a different event type, and another user's event
  db.seedHistory({ userId: A, event: "paywall_view", seriesId: SERIES, seriesTitle: "S1", occurredAt: "2026-01-03T00:00:00.000Z" });
  db.seedHistory({ userId: B, event: "play", seriesId: SERIES, seriesTitle: "S1", occurredAt: "2026-01-04T00:00:00.000Z" });

  const res = await handleGetHistory(A, null, db);
  assert.equal(res.status, 200);
  const h = (res.body as { history: { event: string; seriesId: string }[] }).history;
  assert.equal(h.length, 2, "only A's watch events, paywall_view excluded, B's event excluded");
  assert.equal(h[0].seriesId, SERIES2, "newest first");
  assert.equal(h[1].seriesId, SERIES);

  // limit is honored and validated
  assert.equal(((await handleGetHistory(A, "1", db)).body as { history: unknown[] }).history.length, 1);
  assert.equal((await handleGetHistory(A, "0", db)).status, 400);
  assert.equal((await handleGetHistory(A, "-5", db)).status, 400);
});
