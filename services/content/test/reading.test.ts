// Prompt 28 reading engine tests: the demand sensor (signal mapping + score + readiness gate) and the
// graduation plan (work chapters -> series + beats, consent/provenance carried forward). Pure, no DB. No em dashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeDemandScore,
  mapDemandSignals,
  graduationPlan,
  buildDemandSignalsQuery,
  buildUpsertCandidate,
  READY_THRESHOLD,
  MIN_READERS,
  READING_EVENT_TYPES,
  type DemandSignals,
  type WorkRow,
} from "../src/reading.js";

const strongSignals: DemandSignals = { nReaders: 200, completion: 0.8, rereadRate: 0.5, shareRate: 0.4, finishVelocity: 0.7 };

test("computeDemandScore: a strong work with enough readers is ready_to_adapt", () => {
  const v = computeDemandScore(strongSignals);
  assert.ok(v.demandScore >= READY_THRESHOLD, `score ${v.demandScore} clears ${READY_THRESHOLD}`);
  assert.equal(v.status, "ready_to_adapt");
  assert.deepEqual(v.reasons, []);
});

test("computeDemandScore: a strong score but too few readers stays testing (never adapt on a handful)", () => {
  const v = computeDemandScore({ ...strongSignals, nReaders: 5 });
  assert.equal(v.status, "testing");
  assert.ok(v.reasons.some((r) => r.includes("readers")));
  assert.ok(v.demandScore >= READY_THRESHOLD, "the score itself is still strong");
  assert.ok(MIN_READERS > 5);
});

test("computeDemandScore: a weak work with many readers stays testing", () => {
  const v = computeDemandScore({ nReaders: 500, completion: 0.2, rereadRate: 0.05, shareRate: 0.02, finishVelocity: 0.1 });
  assert.equal(v.status, "testing");
  assert.ok(v.demandScore < READY_THRESHOLD);
});

test("mapDemandSignals derives rates defensively (no divide-by-zero on a fresh work)", () => {
  const fresh = mapDemandSignals({ readers: 0, starts: 0, finishes: 0, rereads: 0, sharers: 0, avg_completion: null });
  assert.equal(fresh.nReaders, 0);
  assert.equal(fresh.completion, 0);
  assert.equal(fresh.rereadRate, 0);
  const s = mapDemandSignals({ readers: "100", starts: "300", finishes: "70", rereads: "60", sharers: "30", avg_completion: 0.55 });
  assert.equal(s.completion, 0.7); // 70/100
  assert.equal(s.rereadRate, 0.2); // 60/300
  assert.equal(s.shareRate, 0.3); // 30/100
  assert.equal(s.finishVelocity, 0.55);
});

test("buildDemandSignalsQuery keys on payload work_id and the reading event types only", () => {
  const q = buildDemandSignalsQuery();
  assert.match(q.text, /payload->>'work_id' = \$1/);
  assert.match(q.text, /chapter_started/);
  assert.match(q.text, /work_finished/);
  assert.deepEqual(q.params("w-1"), ["w-1"]);
});

test("buildUpsertCandidate preserves an in-flight adapting/adapted status on re-score", () => {
  const u = buildUpsertCandidate();
  assert.match(u.text, /on conflict \(work_id\) do update/);
  assert.match(u.text, /in \('adapting','adapted'\)/, "a re-score never demotes a graduating work");
  const params = u.params("w-1", { demandScore: 0.7, status: "ready_to_adapt", reasons: [] }, strongSignals);
  assert.equal(params[0], "w-1");
  assert.equal(params[3], "ready_to_adapt");
});

const work: WorkRow = {
  id: "work-1",
  title: "Rainfall Hearts",
  genre: "romance",
  base_language: "en",
  available_languages: ["en", "es"],
  cover_url: "https://cdn/cover.jpg",
  consent_ref: "consent-abc",
  provenance_id: "11111111-1111-1111-1111-111111111111",
};

test("graduationPlan seeds a series + one beat per chapter, carrying consent and provenance forward", () => {
  const plan = graduationPlan(work, [{ index: 2, title: "Two" }, { index: 1, title: "One" }, { index: 3, title: "Three" }]);
  assert.equal(plan.series.title, "Rainfall Hearts");
  assert.equal(plan.series.genre, "romance");
  assert.deepEqual(plan.series.available_languages, ["en", "es"]);
  assert.equal(plan.episode.episode_number, 1, "beats need an episode; graduation seeds episode 1");
  assert.equal(plan.beats.length, 3);
  // chapters sorted by index; first beat setup, last ending
  assert.equal(plan.beats[0].role, "setup");
  assert.equal(plan.beats[0].beat_index, 0);
  assert.equal(plan.beats[0].canon_facts.source_chapter_index, 1);
  assert.equal(plan.beats[2].role, "ending");
  assert.equal(plan.beats[1].role, "rising");
  // the source work + consent + provenance carry forward (one substrate, cleanly licensed)
  assert.equal(plan.beats[0].canon_facts.source_work_id, "work-1");
  assert.equal(plan.consentRef, "consent-abc");
  assert.equal(plan.provenanceId, "11111111-1111-1111-1111-111111111111");
});

test("graduationPlan refuses a work with no chapters (no empty series)", () => {
  assert.throws(() => graduationPlan(work, []), /no chapters/);
});

test("the reading event taxonomy is the demand sensor input set", () => {
  assert.ok(READING_EVENT_TYPES.includes("chapter_completed"));
  assert.ok(READING_EVENT_TYPES.includes("work_finished"));
  assert.ok(READING_EVENT_TYPES.includes("work_shared"));
  assert.equal(READING_EVENT_TYPES.length, 6);
});
