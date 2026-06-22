// Prompt 28 reading orchestration tests: recomputeDemand persists the verdict; adaptWork graduates a ready
// work into a series + beats and refuses an unready or chapter-less one. Fake ReadingDb, no DB. No em dashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recomputeDemand, adaptWork, ReadingError, type ReadingDb } from "../src/reading-service.js";
import type { DemandSignals, DemandVerdict, GraduationPlan, WorkRow, ChapterRow } from "../src/reading.js";

const WORK: WorkRow = {
  id: "w-1", title: "Rainfall Hearts", genre: "romance", base_language: "en",
  available_languages: ["en"], cover_url: null, consent_ref: "consent-1", provenance_id: "prov-1",
};

class FakeReadingDb implements ReadingDb {
  upserted: { verdict: DemandVerdict; signals: DemandSignals } | null = null;
  linked: { workId: string; seriesId: string } | null = null;
  seededFrom: GraduationPlan | null = null;
  constructor(
    private opts: { work?: WorkRow | null; chapters?: ChapterRow[]; signals?: DemandSignals; status?: string | null } = {},
  ) {}
  async getWork() { return this.opts.work === undefined ? WORK : this.opts.work; }
  async listChapters() { return this.opts.chapters ?? [{ index: 1, title: "One" }, { index: 2, title: "Two" }]; }
  async demandSignals() { return this.opts.signals ?? { nReaders: 200, completion: 0.8, rereadRate: 0.5, shareRate: 0.4, finishVelocity: 0.7 }; }
  async upsertCandidate(_w: string, verdict: DemandVerdict, signals: DemandSignals) { this.upserted = { verdict, signals }; }
  async candidateStatus() { return this.opts.status ?? "ready_to_adapt"; }
  async seedSeriesFromPlan(plan: GraduationPlan) { this.seededFrom = plan; return { seriesId: "series-99" }; }
  async linkGraduated(workId: string, seriesId: string) { this.linked = { workId, seriesId }; }
}

test("recomputeDemand scores the signals and persists the verdict", async () => {
  const db = new FakeReadingDb();
  const { verdict } = await recomputeDemand("w-1", db);
  assert.equal(verdict.status, "ready_to_adapt");
  assert.ok(db.upserted, "verdict persisted");
  assert.equal(db.upserted!.verdict.status, "ready_to_adapt");
});

test("adaptWork graduates a ready work: seeds the series from chapters and links the candidate", async () => {
  const db = new FakeReadingDb();
  const res = await adaptWork("w-1", db);
  assert.equal(res.seriesId, "series-99");
  assert.equal(res.beats, 2, "one beat per chapter");
  assert.equal(res.consentRef, "consent-1", "consent carried forward");
  assert.equal(res.provenanceId, "prov-1", "provenance carried forward");
  assert.deepEqual(db.linked, { workId: "w-1", seriesId: "series-99" });
  assert.equal(db.seededFrom!.episode.episode_number, 1);
});

test("adaptWork refuses a work that is not ready_to_adapt (unless forced)", async () => {
  const db = new FakeReadingDb({ status: "testing" });
  await assert.rejects(() => adaptWork("w-1", db), (e: unknown) => e instanceof ReadingError && e.code === "not_ready");
  // force overrides the readiness gate
  const forced = await adaptWork("w-1", db, { force: true });
  assert.equal(forced.seriesId, "series-99");
});

test("adaptWork refuses an unknown work and a chapter-less work", async () => {
  await assert.rejects(() => adaptWork("w-x", new FakeReadingDb({ work: null }), { force: true }), (e: unknown) => e instanceof ReadingError && e.code === "work_not_found");
  await assert.rejects(() => adaptWork("w-1", new FakeReadingDb({ chapters: [] }), { force: true }), (e: unknown) => e instanceof ReadingError && e.code === "no_chapters");
});
