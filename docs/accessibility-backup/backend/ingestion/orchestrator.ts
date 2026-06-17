// The ingest orchestrator (C17). Runs the stage DAG idempotently and resumably: a crash or partial failure
// re-runs ONLY the missing stages, never a completed one, and never produces a duplicate (the same
// durability discipline as recovering from context loss). Cost-bearing stages are metered against a budget
// (C16) and the job PAUSES rather than overspend. Each produced artifact is registered onto the variant
// (0009a track fields) and C2PA-signed via injected ports, so this module has no I/O of its own and is
// fully testable. No em dashes.

import type { Stage } from "./stages.js";

export type StageStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface StageState {
  id: string;
  status: StageStatus;
  artifact?: string;
  costUsd?: number;
  error?: string;
}

export interface IngestJob {
  jobId: string;
  seriesId: string;
  tier: "hero" | "longtail";
  budgetUsd: number;
  spentUsd: number;
  stages: Record<string, StageState>;
}

export function initJob(jobId: string, seriesId: string, tier: "hero" | "longtail", budgetUsd: number, stages: Stage[]): IngestJob {
  const map: Record<string, StageState> = {};
  for (const s of stages) map[s.id] = { id: s.id, status: "pending" };
  return { jobId, seriesId, tier, budgetUsd, spentUsd: 0, stages: map };
}

export function isComplete(job: IngestJob): boolean {
  return Object.values(job.stages).every((s) => s.status === "done" || s.status === "skipped");
}

// A stage is runnable when it is pending and every dependency is done.
function runnable(stage: Stage, job: IngestJob): boolean {
  if (job.stages[stage.id]?.status !== "pending") return false;
  return stage.deps.every((d) => job.stages[d]?.status === "done");
}

export interface RunPorts {
  // Produce the artifact for a stage. The real executor calls transcribe/build-captions/build-ad/build-
  // sign/generate-dubbing etc.; tests inject a fake. Returns the artifact ref and the actual cost.
  execute(stage: Stage, job: IngestJob): Promise<{ artifact: string; costUsd: number }>;
  // Register the artifact onto the variant via the 0009a track fields and C2PA-sign it. Optional.
  register?(stage: Stage, artifact: string, job: IngestJob): Promise<void>;
  onProgress?(job: IngestJob): void;
}

export interface RunResult {
  job: IngestJob;
  paused: boolean; // true when a generation stage could not run within budget
  ranStageIds: string[]; // stages executed THIS run (empty on a re-run of a complete job)
  pausedReason?: string;
}

// Run the DAG to completion or until the budget pauses it. Pure orchestration over the injected ports.
// Re-invoking with the same (mutated or persisted) job resumes: done stages are skipped, only missing
// stages run.
export async function runJob(job: IngestJob, stages: Stage[], ports: RunPorts): Promise<RunResult> {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const ran: string[] = [];
  let paused = false;
  let pausedReason: string | undefined;

  // Keep sweeping until no stage advances (either all done, or only budget-blocked/failed stages remain).
  let progressed = true;
  while (progressed && !paused) {
    progressed = false;
    for (const stage of stages) {
      if (!runnable(stage, job)) continue;
      // Cost gate (C16): a generation stage must fit the remaining budget, else PAUSE (leave it pending so
      // a later run with more budget resumes it). Non-generation stages never pause.
      if (stage.generates) {
        if (job.spentUsd + stage.estimateUsd > job.budgetUsd) {
          paused = true;
          pausedReason = `cost gate: ${stage.id} estimate ${stage.estimateUsd} over remaining budget ${(job.budgetUsd - job.spentUsd).toFixed(2)}`;
          break;
        }
      }
      const st = job.stages[stage.id];
      st.status = "running";
      try {
        const { artifact, costUsd } = await ports.execute(stage, job);
        st.artifact = artifact;
        st.costUsd = costUsd;
        st.status = "done";
        job.spentUsd += costUsd;
        if (ports.register) await ports.register(stage, artifact, job);
        ran.push(stage.id);
        progressed = true;
        ports.onProgress?.(job);
      } catch (e) {
        st.status = "failed";
        st.error = e instanceof Error ? e.message : String(e);
        // A failed stage does not block the rest of this sweep; it just will not satisfy dependents. It is
        // left failed so a later run can retry it (set it back to pending to retry).
      }
    }
  }
  return { job, paused, ranStageIds: ran, pausedReason };
}

// Reset failed stages to pending so a resume retries them (idempotent: done stages are untouched).
export function retryFailed(job: IngestJob): IngestJob {
  for (const s of Object.values(job.stages)) if (s.status === "failed") s.status = "pending";
  return job;
}
