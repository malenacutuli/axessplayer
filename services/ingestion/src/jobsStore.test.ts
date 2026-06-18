// SLICE B acceptance for the produce-job store + per-stage state machine. The unwired store computes the
// plan/estimate on create (the preview) but persists nothing durable (GET /jobs empty, source unwired); the
// state machine advances stages in DAG order and NEVER fabricates a completed asset under the unwired
// executor; a real executor that returns an assetId moves a stage to done. No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UnwiredJobsStore,
  advanceJob,
  unwiredExecutor,
  stagesForPlan,
  deriveJobId,
  type ProduceJob,
  type StageExecutor,
} from "./jobsStore.js";
import { computePlan, type ProduceTargets } from "./produceCost.js";

const targets: ProduceTargets = {
  languages: ["en", "es"],
  tracks: { cc: true, ad: true, sign: true, dub: true },
  signLanguages: ["ASL"],
  costTier: "hero",
};
const seriesId = "11111111-1111-1111-1111-111111111111";

describe("UnwiredJobsStore", () => {
  it("create computes the plan + estimate and queues the job, but list stays empty (unwired)", async () => {
    const store = new UnwiredJobsStore();
    const { job, plan } = await store.create({ seriesId, targets, beats: 1 });
    assert.equal(job.state, "queued");
    assert.equal(job.seriesId, seriesId);
    assert.equal(job.kind, "produce");
    assert.equal(job.estimatedUsd, plan.estimatedUsd);
    assert.ok(job.stages.length > 0);
    // every stage starts pending with no fabricated asset
    for (const s of job.stages) {
      assert.equal(s.status, "pending");
      assert.equal(s.assetId, null);
    }
    // the durable list is empty while unwired
    assert.deepEqual(await store.list(), []);
    assert.equal(store.wired, false);
  });

  it("create is idempotent: the same targets derive the same job id", async () => {
    const store = new UnwiredJobsStore();
    const a = await store.create({ seriesId, targets, beats: 2 });
    const b = await store.create({ seriesId, targets, beats: 2 });
    assert.equal(a.job.jobId, b.job.jobId);
  });

  it("get reads back a just-created job within the process; unknown id is null", async () => {
    const store = new UnwiredJobsStore();
    const { job } = await store.create({ seriesId, targets, beats: 1 });
    assert.equal((await store.get(job.jobId))?.jobId, job.jobId);
    assert.equal(await store.get("nope"), null);
  });

  it("stagesForPlan emits only planned stages in canonical DAG order", () => {
    const plan = computePlan({ ...targets, tracks: { cc: true } }, 1);
    const names = stagesForPlan(plan).map((s) => s.name);
    assert.deepEqual(
      names,
      ["transcript", "captions", "cwi", "poster", "register", "publish"]
    );
  });

  it("deriveJobId is stable and encodes the estimate", () => {
    const plan = computePlan(targets, 1);
    const id = deriveJobId({ seriesId, targets, beats: 1 }, plan);
    assert.equal(id, deriveJobId({ seriesId, targets, beats: 1 }, plan));
    assert.match(id, /^prod_/);
  });
});

function freshJob(): ProduceJob {
  const plan = computePlan(targets, 1);
  return {
    jobId: "j",
    seriesId,
    episodeId: null,
    kind: "produce",
    stages: stagesForPlan(plan),
    state: "queued",
    estimatedUsd: plan.estimatedUsd,
  };
}

describe("stage state machine", () => {
  it("the unwired executor advances a stage to running but NEVER to done (no fabricated asset)", () => {
    const job = freshJob();
    advanceJob(job, unwiredExecutor); // pending -> running
    assert.equal(job.stages[0].status, "running");
    assert.equal(job.state, "running");
    // sweeping repeatedly never completes the stage and never sets an asset
    for (let i = 0; i < 10; i++) advanceJob(job, unwiredExecutor);
    assert.equal(job.stages[0].status, "running");
    assert.equal(job.stages[0].assetId, null);
    assert.ok(job.stages.slice(1).every((s) => s.status === "pending"));
  });

  it("a real executor that returns an assetId completes stages in DAG order, then the job is done", () => {
    const job = freshJob();
    const realExec: StageExecutor = (stage) => ({ assetId: `asset:${stage.name}` });
    // each stage needs two ticks: pending->running, running->done
    let guard = 0;
    while (job.state !== "done" && guard++ < 100) advanceJob(job, realExec);
    assert.equal(job.state, "done");
    for (const s of job.stages) {
      assert.equal(s.status, "done");
      assert.equal(s.assetId, `asset:${s.name}`);
    }
  });

  it("a failing stage moves the job to failed", () => {
    const job = freshJob();
    const failExec: StageExecutor = () => ({ failed: true });
    advanceJob(job, failExec); // pending -> running
    advanceJob(job, failExec); // running -> failed
    assert.equal(job.stages[0].status, "failed");
    assert.equal(job.state, "failed");
  });
});
