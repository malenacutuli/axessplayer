// C17 acceptance for the ingest orchestrator: a full hero run produces and registers every derivative; a
// run paused by the cost gate resumes and completes with NO stage executed twice (idempotent + resumable,
// the durability discipline); a complete job re-run is a no-op; cost tiering defers non-base languages;
// and human-interpreter clips match the transcript and gate hero publish. The executors are fakes, so no
// real money or media. No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { accessibilityStages, stagesForTier, type Stage } from "./stages.js";
import { initJob, runJob, isComplete, type RunPorts } from "./orchestrator.js";
import { matchHumanClips, draftSignTrack, publishableForHero } from "./signTier.js";

function fakePorts(): RunPorts & { execCount: Map<string, number>; registered: string[] } {
  const execCount = new Map<string, number>();
  const registered: string[] = [];
  return {
    execCount,
    registered,
    async execute(stage: Stage) {
      execCount.set(stage.id, (execCount.get(stage.id) ?? 0) + 1);
      return { artifact: `${stage.id}:artifact`, costUsd: stage.estimateUsd };
    },
    async register(stage: Stage) {
      registered.push(stage.id);
    },
  };
}

const LANGS = ["en", "es"];
const SIGN = ["ASL", "PSL"];

describe("C17 ingest orchestrator", () => {
  it("a hero run produces, registers, and completes every stage exactly once", async () => {
    const stages = accessibilityStages(LANGS, SIGN);
    const job = initJob("j1", "series1", "hero", 1000, stages);
    const ports = fakePorts();
    const res = await runJob(job, stages, ports);
    assert.equal(res.paused, false);
    assert.equal(isComplete(res.job), true);
    assert.equal(res.ranStageIds.length, stages.length);
    for (const s of stages) {
      assert.equal(job.stages[s.id].status, "done");
      assert.equal(job.stages[s.id].artifact, `${s.id}:artifact`);
      assert.equal(ports.execCount.get(s.id), 1); // no duplicate execution
    }
    assert.equal(ports.registered.length, stages.length); // each registered (0009a + C2PA)
    assert.ok(job.spentUsd > 0);
  });

  it("pauses on the cost gate, then RESUMES to completion with no stage run twice", async () => {
    const stages = accessibilityStages(LANGS, SIGN);
    const job = initJob("j2", "series2", "hero", 0.9, stages); // small budget: pauses partway
    const ports = fakePorts();
    const first = await runJob(job, stages, ports);
    assert.equal(first.paused, true);
    assert.equal(isComplete(job), false);
    const ranFirst = first.ranStageIds.length;
    assert.ok(ranFirst > 0 && ranFirst < stages.length);

    // resume with a real budget (the same job object, as if reloaded from persistence)
    job.budgetUsd = 1000;
    const second = await runJob(job, stages, ports);
    assert.equal(second.paused, false);
    assert.equal(isComplete(job), true);
    // the union of both runs executed every stage exactly once (idempotent + resumable)
    for (const s of stages) assert.equal(ports.execCount.get(s.id), 1, `stage ${s.id} ran more than once`);
    assert.equal(ranFirst + second.ranStageIds.length, stages.length);
  });

  it("re-running a complete job is a no-op (idempotent)", async () => {
    const stages = accessibilityStages(LANGS, SIGN);
    const job = initJob("j3", "series3", "hero", 1000, stages);
    const ports = fakePorts();
    await runJob(job, stages, ports);
    const again = await runJob(job, stages, ports);
    assert.deepEqual(again.ranStageIds, []);
  });

  it("cost tiering: a long-tail title defers non-base languages, hero runs the full set", () => {
    const stages = accessibilityStages(LANGS, SIGN);
    const heroSet = stagesForTier(stages, "hero", "en");
    const tailSet = stagesForTier(stages, "longtail", "en");
    assert.equal(heroSet.length, stages.length);
    assert.ok(tailSet.length < stages.length);
    assert.ok(!tailSet.some((s) => s.lang === "es")); // es deferred to on-demand
    assert.ok(tailSet.some((s) => s.id === "transcript"));
    assert.ok(tailSet.some((s) => s.kind === "sign")); // drafts are the accessibility floor, kept
    assert.ok(tailSet.some((s) => s.id === "captions:en")); // base language kept
  });
});

describe("C17 sign quality tiers", () => {
  const transcript = [
    { start: 0, end: 2, text: "Wait." },
    { start: 2, end: 5, text: "I can explain." },
    { start: 5, end: 8, text: "Who sent that?" },
  ];
  it("auto draft is the assistive tier; human clips match the transcript and form the quality tier", () => {
    assert.equal(draftSignTrack("ASL", "http://m/asl_sign.webm").tier, "draft");
    const track = matchHumanClips("ASL", transcript, [
      { url: "c1.mp4", start: 0, end: 2.5 },
      { url: "c2.mp4", start: 2.5, end: 8 },
    ]);
    assert.equal(track.tier, "quality");
    assert.equal(track.coverage, 1); // all three segments overlapped by a clip
    assert.equal(track.needsDeafReview, true);
  });
  it("hero publish requires the human quality tier, full coverage, and a Deaf review", () => {
    const full = matchHumanClips("ASL", transcript, [{ url: "c.mp4", start: 0, end: 8 }]);
    assert.equal(publishableForHero(full, false), false); // no review yet
    assert.equal(publishableForHero(full, true), true);
    assert.equal(publishableForHero(draftSignTrack("ASL", "d.webm"), true), false); // draft never hero-publishable
  });
});
