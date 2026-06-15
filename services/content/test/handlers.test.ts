// Handler tests for the content graph API, against the real frozen schema on PGlite (fast suite).
// Proves: the graph read matches what the seed produces for the walking-skeleton series; the create
// endpoints build that same graph from empty; the composite-FK rule (a beat's series must equal its
// episode's series) is rejected both by the handler pre-check and by Postgres itself; enums are validated;
// server-authoritative defaults (coin_cost, is_free, is_premium) are applied and a client price is never
// trusted past the documented bounds. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, emptyDb, pgliteContentDb, tryInsertMismatchedBeat, FIX } from "./harness.js";
import {
  handleGetSeriesGraph,
  handleCreateSeries,
  handleCreateEpisode,
  handleCreateBeat,
  handleCreateVariant,
  handleCreateEdge,
  type SeriesGraph,
  type SeriesRow,
  type EpisodeRow,
  type BeatRow,
  type VariantRow,
} from "../src/content.js";

// ---------- GET /series/{id}/graph against the seeded walking-skeleton ----------

test("GET /series/{id}/graph resolves the seeded walking-skeleton series", async () => {
  const db = pgliteContentDb(await freshDb());
  const res = await handleGetSeriesGraph(FIX.series, db);
  assert.equal(res.status, 200);
  const g = res.body as SeriesGraph;

  assert.equal(g.series.id, FIX.series);
  assert.equal(g.series.title, "The Last Signal");
  assert.equal(g.series.genre, "thriller");

  // one episode, five beats, six variants total, five edges
  assert.equal(g.episodes.length, 1);
  const ep = g.episodes[0];
  assert.equal(ep.id, FIX.episode);
  assert.equal(ep.episode_number, 1);
  assert.equal(ep.is_free, true);
  assert.equal(ep.coin_cost, 0);
  assert.equal(ep.beats.length, 5);

  // beats are ordered by beat_index
  assert.deepEqual(
    ep.beats.map((b) => b.beat_index),
    [0, 1, 2, 2, 3]
  );

  // the branch point is beat index 1
  const branch = ep.beats.find((b) => b.id === FIX.beatBranchPoint);
  assert.ok(branch);
  assert.equal(branch.is_branch_point, true);

  // the ending beat carries two variants, one of them the premium alternate
  const ending = ep.beats.find((b) => b.id === FIX.beatEnding);
  assert.ok(ending);
  assert.equal(ending.variants.length, 2);
  const premium = ending.variants.find((v) => v.id === FIX.variantPremiumEnding);
  assert.ok(premium);
  assert.equal(premium.is_premium, true);
  assert.equal(premium.coin_cost, 5);
  const free = ending.variants.find((v) => v.id === FIX.variantEnding);
  assert.ok(free);
  assert.equal(free.is_premium, false);
  assert.equal(free.coin_cost, 0);

  // total variants and edges across the graph
  const totalVariants = ep.beats.reduce((n, b) => n + b.variants.length, 0);
  assert.equal(totalVariants, 6);
  assert.equal(g.edges.length, 5);

  // the branch fans out to calm and tense
  const fromBranch = g.edges.filter((e) => e.from_beat_id === FIX.beatBranchPoint);
  assert.equal(fromBranch.length, 2);
  const targets = fromBranch.map((e) => e.to_beat_id).sort();
  assert.deepEqual(targets, [FIX.beatCalm, FIX.beatTense].sort());
});

test("GET /series/{id}/graph returns 404 for an unknown series", async () => {
  const db = pgliteContentDb(await freshDb());
  const res = await handleGetSeriesGraph("99999999-9999-9999-9999-999999999999", db);
  assert.equal(res.status, 404);
  assert.equal((res.body as { error: string }).error, "series_not_found");
});

test("GET /series/{id}/graph returns 404 for a malformed id without touching the DB", async () => {
  const db = pgliteContentDb(await freshDb());
  const res = await handleGetSeriesGraph("not-a-uuid", db);
  assert.equal(res.status, 404);
});

// ---------- build the walking-skeleton through the create endpoints, from empty ----------

test("the create endpoints build a graph the read endpoint resolves identically", async () => {
  const db = pgliteContentDb(await emptyDb());

  const series = (await okBody(handleCreateSeries({ title: "Built Series", genre: "thriller" }, db))) as SeriesRow;
  const ep = (await okBody(
    handleCreateEpisode({ series_id: series.id, episode_number: 1, title: "Pilot", is_free: true }, db)
  )) as EpisodeRow;

  const coldOpen = (await okBody(
    handleCreateBeat({ series_id: series.id, episode_id: ep.id, beat_index: 0, role: "cold_open" }, db)
  )) as BeatRow;
  const branch = (await okBody(
    handleCreateBeat({ series_id: series.id, episode_id: ep.id, beat_index: 1, role: "spine", is_branch_point: true }, db)
  )) as BeatRow;
  const calm = (await okBody(
    handleCreateBeat({ series_id: series.id, episode_id: ep.id, beat_index: 2, role: "variant" }, db)
  )) as BeatRow;
  const tense = (await okBody(
    handleCreateBeat({ series_id: series.id, episode_id: ep.id, beat_index: 2, role: "variant" }, db)
  )) as BeatRow;
  const ending = (await okBody(
    handleCreateBeat({ series_id: series.id, episode_id: ep.id, beat_index: 3, role: "ending" }, db)
  )) as BeatRow;

  for (const b of [coldOpen, branch, calm, tense, ending]) {
    await okBody(
      handleCreateVariant({ beat_id: b.id, tier: "A_filmed", playback_url: `https://cdn/${b.id}.m3u8` }, db)
    );
  }
  // a premium alternate ending
  const premium = (await okBody(
    handleCreateVariant(
      { beat_id: ending.id, tier: "A_filmed", is_premium: true, coin_cost: 5, intensity: 4, playback_url: "https://cdn/premium.m3u8" },
      db
    )
  )) as VariantRow;

  await okBody(handleCreateEdge({ from_beat_id: coldOpen.id, to_beat_id: branch.id }, db));
  await okBody(handleCreateEdge({ from_beat_id: branch.id, to_beat_id: calm.id, condition: { branch: "calm" } }, db));
  await okBody(handleCreateEdge({ from_beat_id: branch.id, to_beat_id: tense.id, condition: { branch: "tense" } }, db));
  await okBody(handleCreateEdge({ from_beat_id: calm.id, to_beat_id: ending.id }, db));
  await okBody(handleCreateEdge({ from_beat_id: tense.id, to_beat_id: ending.id }, db));

  const res = await handleGetSeriesGraph(series.id, db);
  assert.equal(res.status, 200);
  const g = res.body as SeriesGraph;
  assert.equal(g.episodes.length, 1);
  assert.equal(g.episodes[0].beats.length, 5);
  assert.equal(g.episodes[0].beats.reduce((n, b) => n + b.variants.length, 0), 6);
  assert.equal(g.edges.length, 5);
  const endingNode = g.episodes[0].beats.find((b) => b.id === ending.id);
  assert.ok(endingNode);
  assert.equal(endingNode.variants.length, 2);
  assert.ok(endingNode.variants.some((v) => v.id === premium.id && v.is_premium && v.coin_cost === 5));
});

// ---------- composite-FK integrity (M2) ----------

test("createBeat rejects a beat whose series does not match its episode (handler 400)", async () => {
  const db = pgliteContentDb(await freshDb());
  const otherSeries = (await okBody(handleCreateSeries({ title: "Other" }, db))) as SeriesRow;
  // The seeded episode belongs to FIX.series; claim it under a different series.
  const res = await handleCreateBeat(
    { series_id: otherSeries.id, episode_id: FIX.episode, beat_index: 7, role: "spine" },
    db
  );
  assert.equal(res.status, 400);
  assert.equal((res.body as { error: string }).error, "series_episode_mismatch");
});

test("the schema composite FK itself rejects a mismatched beat, not only the handler", async () => {
  const raw = await freshDb();
  // Bypass the handler and write straight to the table with a wrong series_id for the seeded episode.
  const msg = await tryInsertMismatchedBeat(raw, FIX.episode, "99999999-9999-9999-9999-999999999999");
  assert.notEqual(msg, "", "the DB should have raised");
  assert.match(msg, /foreign key|violates|constraint/i);
});

test("createBeat rejects an unknown episode", async () => {
  const db = pgliteContentDb(await freshDb());
  const res = await handleCreateBeat(
    { series_id: FIX.series, episode_id: "99999999-9999-9999-9999-999999999999", beat_index: 0, role: "spine" },
    db
  );
  assert.equal(res.status, 400);
  assert.equal((res.body as { error: string }).error, "unknown_episode_id");
});

// ---------- enum validation ----------

test("createBeat rejects a bad role enum before the DB", async () => {
  const db = pgliteContentDb(await freshDb());
  const res = await handleCreateBeat(
    { series_id: FIX.series, episode_id: FIX.episode, beat_index: 0, role: "villain" as never },
    db
  );
  assert.equal(res.status, 400);
  assert.equal((res.body as { error: string }).error, "invalid_role");
});

test("createVariant rejects a bad tier enum and a bad qa_status", async () => {
  const db = pgliteContentDb(await freshDb());
  const badTier = await handleCreateVariant(
    { beat_id: FIX.beatColdOpen, tier: "D_deepfake" as never, playback_url: "https://cdn/x.m3u8" },
    db
  );
  assert.equal(badTier.status, 400);
  assert.equal((badTier.body as { error: string }).error, "invalid_tier");

  const badQa = await handleCreateVariant(
    { beat_id: FIX.beatColdOpen, tier: "A_filmed", qa_status: "maybe" as never, playback_url: "https://cdn/x.m3u8" },
    db
  );
  assert.equal(badQa.status, 400);
  assert.equal((badQa.body as { error: string }).error, "invalid_qa_status");
});

test("createVariant rejects an out-of-range intensity", async () => {
  const db = pgliteContentDb(await freshDb());
  const res = await handleCreateVariant(
    { beat_id: FIX.beatColdOpen, tier: "A_filmed", intensity: 9, playback_url: "https://cdn/x.m3u8" },
    db
  );
  assert.equal(res.status, 400);
  assert.equal((res.body as { error: string }).error, "invalid_intensity");
});

// ---------- server-authoritative defaults ----------

test("createEpisode applies server defaults (is_free false, coin_cost 0) when omitted", async () => {
  const db = pgliteContentDb(await freshDb());
  const series = (await okBody(handleCreateSeries({ title: "Defaults" }, db))) as SeriesRow;
  const ep = (await okBody(handleCreateEpisode({ series_id: series.id, episode_number: 2 }, db))) as EpisodeRow;
  assert.equal(ep.is_free, false);
  assert.equal(ep.coin_cost, 0);
});

test("createVariant applies server defaults (is_premium false, coin_cost 0, language en, qa pending)", async () => {
  const db = pgliteContentDb(await freshDb());
  const v = (await okBody(
    handleCreateVariant({ beat_id: FIX.beatColdOpen, tier: "A_filmed", playback_url: "https://cdn/x.m3u8" }, db)
  )) as VariantRow;
  assert.equal(v.is_premium, false);
  assert.equal(v.coin_cost, 0);
  assert.equal(v.language, "en");
  assert.equal(v.intensity, 3);
  assert.equal(v.qa_status, "pending");
});

test("createEpisode rejects a negative coin_cost (never trust a client price)", async () => {
  const db = pgliteContentDb(await freshDb());
  const series = (await okBody(handleCreateSeries({ title: "Neg" }, db))) as SeriesRow;
  const res = await handleCreateEpisode({ series_id: series.id, episode_number: 3, coin_cost: -50 }, db);
  assert.equal(res.status, 400);
  assert.equal((res.body as { error: string }).error, "invalid_coin_cost");
});

test("createSeries rejects an empty title and createEpisode rejects an unknown series", async () => {
  const db = pgliteContentDb(await freshDb());
  const badTitle = await handleCreateSeries({ title: "   " }, db);
  assert.equal(badTitle.status, 400);
  const unknownSeries = await handleCreateEpisode(
    { series_id: "99999999-9999-9999-9999-999999999999", episode_number: 1 },
    db
  );
  assert.equal(unknownSeries.status, 400);
  assert.equal((unknownSeries.body as { error: string }).error, "unknown_series_id");
});

// ---------- edges ----------

test("createEdge rejects a self edge and an unknown beat", async () => {
  const db = pgliteContentDb(await freshDb());
  const selfEdge = await handleCreateEdge({ from_beat_id: FIX.beatColdOpen, to_beat_id: FIX.beatColdOpen }, db);
  assert.equal(selfEdge.status, 400);
  assert.equal((selfEdge.body as { error: string }).error, "self_edge");

  const unknown = await handleCreateEdge(
    { from_beat_id: FIX.beatColdOpen, to_beat_id: "99999999-9999-9999-9999-999999999999" },
    db
  );
  assert.equal(unknown.status, 400);
  assert.equal((unknown.body as { error: string }).error, "unknown_to_beat_id");
});

// ---------- helper ----------

async function okBody<T>(p: Promise<{ status: number; body: T | { error: string } }>): Promise<T> {
  const res = await p;
  if (res.status !== 201) {
    throw new Error(`expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body as T;
}
