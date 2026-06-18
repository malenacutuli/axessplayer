// The produce-job store + per-stage state machine behind the JOB API CONTRACT (GET /jobs, GET /jobs/:id,
// POST /produce). A produce job is a row in the ADDITIVE mobile.produce_jobs table (scripts/sql/
// 08_produce_jobs.sql, queued for apply, NOT executed here). Until that table is applied the store is
// UNWIRED: it persists nothing, GET /jobs returns an empty list with source:"unwired", and a POST /produce
// computes + returns the plan/estimate (the cost-before-commit preview) without claiming any stage ran.
//
// The stage executor is a STUBBED async state machine: stages advance pending -> running -> done in DAG
// order. It NEVER fabricates a completed asset: a stage carries assetId only when a real executor (the
// auto-produce factory / media-server) supplies one; the stub leaves assetId null and the job state stays
// "running"/"queued", flagged source:"unwired", until the real orchestrator is connected. No em dashes.

import { DAG_STAGE_ORDER, computePlan, type DagStageName, type ProducePlan, type ProduceTargets } from "./produceCost.js";

export type JobStageStatus = "pending" | "running" | "done" | "failed" | "skipped";
export type JobState = "queued" | "running" | "paused" | "done" | "failed";

// One stage in the JOB API CONTRACT shape: {name, status, cost, assetId}.
export interface JobStage {
  name: DagStageName;
  status: JobStageStatus;
  cost: number; // estimated USD for this stage (the planned cost; actual cost lands when a real run reports it)
  assetId: string | null; // the produced asset ref, ONLY when a real executor produced one (never fabricated)
}

// The JOB API CONTRACT job shape returned by GET /jobs / GET /jobs/:id.
export interface ProduceJob {
  jobId: string;
  seriesId: string;
  episodeId: string | null;
  kind: string; // "produce"
  stages: JobStage[];
  state: JobState;
  estimatedUsd: number;
}

export interface CreateJobInput {
  seriesId: string;
  episodeId?: string | null;
  targets: ProduceTargets;
  beats?: number;
  // The variant to produce: its PUBLIC video URL (the edge functions read it) + the variant id the produced
  // tracks register onto. Present when POST /produce can run a REAL job; absent for a preview-only request.
  variant?: { variantId: string; videoUrl: string };
}

// Build the per-stage list for a plan: only the stages the plan actually includes (a track the creator did
// not request never appears), in canonical DAG order. Each starts pending with no asset.
export function stagesForPlan(plan: ProducePlan): JobStage[] {
  const planned = new Map(plan.stages.map((s) => [s.name, s]));
  const list: JobStage[] = [];
  for (const name of DAG_STAGE_ORDER) {
    const p = planned.get(name as DagStageName);
    if (!p) continue;
    list.push({ name: name as DagStageName, status: "pending", cost: p.costUsd, assetId: null });
  }
  return list;
}

// Deterministic job id from the request shape, so a repeated produce of the same targets is the same job
// (idempotent at the API level; the table has a unique key on the same inputs, see the SQL).
export function deriveJobId(input: CreateJobInput, plan: ProducePlan): string {
  const ep = input.episodeId ?? "all";
  const cents = Math.round(plan.estimatedUsd * 100);
  return `prod_${input.seriesId.slice(0, 8)}_${ep.slice(0, 8)}_${plan.stageCount}_${cents}`;
}

// --- the state machine: advance the first runnable stage one step. pending -> running -> done in DAG order
// (one stage at a time, like the orchestrator sweep). A stage moves to "done" with an asset ONLY if the
// injected executor returns one; otherwise it stays "running" (real production has not produced the asset).
// Returns the advanced job. Pure over the passed job (mutates and returns it).
export interface StageOutcome {
  assetId?: string | null; // a real produced asset ref, or null/undefined when nothing real exists yet
  failed?: boolean;
}
export type StageExecutor = (stage: JobStage, job: ProduceJob) => StageOutcome;

// The default executor is UNWIRED: it advances a stage to "running" but never to "done", because no real
// asset exists. It never fabricates an assetId. This keeps the state machine observable while the real
// orchestrator is not connected.
export const unwiredExecutor: StageExecutor = () => ({ assetId: null });

export function advanceJob(job: ProduceJob, exec: StageExecutor = unwiredExecutor): ProduceJob {
  const next = job.stages.find((s) => s.status === "pending" || s.status === "running");
  if (!next) {
    job.state = job.stages.some((s) => s.status === "failed") ? "failed" : "done";
    return job;
  }
  if (next.status === "pending") {
    next.status = "running";
    job.state = "running";
    return job;
  }
  // next.status === "running": ask the executor for the real outcome.
  const outcome = exec(next, job);
  if (outcome.failed) {
    next.status = "failed";
    job.state = "failed";
    return job;
  }
  if (outcome.assetId != null && outcome.assetId.length > 0) {
    next.assetId = outcome.assetId;
    next.status = "done";
    job.state = "running";
  }
  // else: no real asset yet, stage stays "running" (the unwired path); state remains "running".
  return job;
}

// --- the store interface. The default is the unwired in-memory store (table not applied). A future PgJobsStore
// (when 08_produce_jobs.sql is applied) implements the same interface against mobile.produce_jobs.
export interface JobsStore {
  // True once the produce_jobs table is applied and the store persists rows. Drives the source field.
  readonly wired: boolean;
  create(input: CreateJobInput): Promise<{ job: ProduceJob; plan: ProducePlan }>;
  list(): Promise<ProduceJob[]>;
  get(jobId: string): Promise<ProduceJob | null>;
}

// The unwired in-memory store. Computes + returns the plan on create (the cost preview) and keeps the job in
// process memory so GET /jobs/:id can read back the just-created job within the process, but reports wired:
// false so the API surfaces source:"unwired" and GET /jobs (the durable list) stays empty: nothing is
// persisted across processes until the table is applied. No fabricated completed assets.
export class UnwiredJobsStore implements JobsStore {
  readonly wired = false;
  private readonly mem = new Map<string, ProduceJob>();

  async create(input: CreateJobInput): Promise<{ job: ProduceJob; plan: ProducePlan }> {
    const plan = computePlan(input.targets, input.beats ?? 1);
    const jobId = deriveJobId(input, plan);
    const existing = this.mem.get(jobId);
    if (existing) return { job: existing, plan };
    const job: ProduceJob = {
      jobId,
      seriesId: input.seriesId,
      episodeId: input.episodeId ?? null,
      kind: "produce",
      stages: stagesForPlan(plan),
      state: "queued",
      estimatedUsd: plan.estimatedUsd,
    };
    this.mem.set(jobId, job);
    return { job, plan };
  }

  // The durable list is empty while unwired: a queued job lives only in this process and is not a committed
  // produce record until the table is applied. This is the contract's source:"unwired" empty state.
  async list(): Promise<ProduceJob[]> {
    return [];
  }

  // Within-process read-back of a just-created job (so a POST then GET /jobs/:id in the same process works);
  // returns null across processes, consistent with nothing being persisted yet.
  async get(jobId: string): Promise<ProduceJob | null> {
    return this.mem.get(jobId) ?? null;
  }
}

// The REAL produce store. On create it computes the plan/estimate (the same preview the unwired store
// returns) AND, when the request carries a variant with a public video URL, enqueues a REAL async run: it
// drives the accessibility factory (transcribe / captions / AD / dub / poster / register) by the injected
// runner and mutates the in-process job as stages complete, so GET /jobs/:id reflects real progress. The job
// is held in process memory (GET /jobs lists active runs); durable cross-process persistence remains the
// produce_jobs-table cutover (this store reports wired:true because it runs real production). The runner +
// the per-variant runtime (edge/storage/content ports) are injected so this stays testable. No em dashes.
export interface RealStoreRunner {
  // Drive a job to completion / clean stop over the REAL stages, mutating the job in place. Injected so the
  // store has no network dependency of its own (the runtime adapters live in produceRuntime.ts).
  run(job: ProduceJob, input: CreateJobInput): Promise<void>;
}

export class RealProduceStore implements JobsStore {
  readonly wired = true;
  private readonly mem = new Map<string, ProduceJob>();
  // Track in-flight runs so a duplicate POST does not launch a second run of the same job.
  private readonly running = new Set<string>();

  constructor(private readonly runner: RealStoreRunner) {}

  async create(input: CreateJobInput): Promise<{ job: ProduceJob; plan: ProducePlan }> {
    const plan = computePlan(input.targets, input.beats ?? 1);
    const jobId = deriveJobId(input, plan);
    let job = this.mem.get(jobId);
    if (!job) {
      job = {
        jobId,
        seriesId: input.seriesId,
        episodeId: input.episodeId ?? null,
        kind: "produce",
        stages: stagesForPlan(plan),
        state: "queued",
        estimatedUsd: plan.estimatedUsd,
      };
      this.mem.set(jobId, job);
    }
    // Launch a REAL run only when a variant (public video URL) is supplied and not already running. Fire and
    // forget: POST /produce enqueues; the executor advances stages async and GET /jobs/:id observes progress.
    if (input.variant && !this.running.has(jobId)) {
      this.running.add(jobId);
      const j = job;
      void this.runner
        .run(j, input)
        .catch((e) => {
          j.state = "failed";
          // eslint-disable-next-line no-console
          console.error(`produce run ${jobId} failed`, e);
        })
        .finally(() => this.running.delete(jobId));
    }
    return { job, plan };
  }

  async list(): Promise<ProduceJob[]> {
    return [...this.mem.values()];
  }

  async get(jobId: string): Promise<ProduceJob | null> {
    return this.mem.get(jobId) ?? null;
  }
}
