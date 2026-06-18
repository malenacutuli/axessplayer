// Ingestion job client for the Studio. The ingestion service (services/ingestion, VITE_INGESTION_BASE_URL)
// owns the auto-produce factory: it plans the accessibility fan-out, enqueues a job, and runs the executor
// async. The Studio reads job state for the live PROCESSING DASHBOARD and the REVIEW QUEUE, and writes the
// PROCESS trigger via POST /produce. This is a thin, typed wrapper over fetch with a configurable base URL.
//
// JOB API CONTRACT (frozen by the orchestrator, mirrored here as the consumer view):
//   GET  /jobs            -> Job[] (jobId, seriesId, episodeId, kind, stages[], state, estimatedUsd)
//   GET  /jobs/:id        -> Job with per-stage detail (name, status, cost, assetId)
//   POST /produce         -> { jobId, plan, estimatedUsd } (enqueue only; the executor runs async)
//
// The base URL is a PUBLIC origin only (no secrets here). Same-origin default so the dev proxy can route
// the /jobs and /produce prefixes to the live ingestion service, mirroring the content client. No em dashes.

export type StageStatus = "queued" | "running" | "ready" | "failed" | "needs_review";
export type JobState = "queued" | "running" | "partial" | "done" | "failed";

export interface JobStage {
  name: string;
  status: StageStatus;
  // Estimated/actual cost in USD for this stage (the cost gate sums these before commit).
  cost: number;
  // The produced asset id once the stage reaches "ready" (or a human-replaced draft); absent while pending.
  assetId?: string;
  // Optional human-facing label and the track family, so the dashboard and review queue can group stages.
  label?: string;
  kind?: TrackKind;
}

export type TrackKind = "transcript" | "poster" | "captions" | "audio_description" | "sign" | "dub";

export interface Job {
  jobId: string;
  seriesId: string;
  episodeId: string;
  kind: string;
  stages: JobStage[];
  state: JobState;
  estimatedUsd: number;
}

// POST /produce request body (GOLD_STANDARD_08 targets, set once at the episode level).
export interface ProduceTargets {
  languages: string[];
  tracks: { cc: boolean; ad: boolean; sign: boolean; dub: boolean };
  signLanguages: string[];
  costTier: "standard" | "hero";
}

export interface ProduceRequest {
  seriesId: string;
  episodeId: string;
  targets: ProduceTargets;
}

// POST /produce response: the enqueued job id, the planned fan-out, and the estimated cost (the executor
// runs async, so no derivatives exist yet).
export interface ProducePlanRow {
  stage: string;
  kind: TrackKind;
  count: number;
  estimatedUsd: number;
}
export interface ProduceResponse {
  jobId: string;
  plan: ProducePlanRow[];
  estimatedUsd: number;
}

export class IngestionApiError extends Error {
  readonly status: number;
  readonly apiError?: string;
  constructor(status: number, apiError?: string) {
    super(apiError ? `ingestion_api_error:${status}:${apiError}` : `ingestion_api_error:${status}`);
    this.name = "IngestionApiError";
    this.status = status;
    this.apiError = apiError;
  }
}

export type FetchLike = typeof fetch;

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}${path}`;
}

export interface IngestionClientOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
}

export class IngestionClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: IngestionClientOptions) {
    this.baseUrl = opts.baseUrl;
    // Bind global fetch to its receiver: a detached browser fetch throws "Illegal invocation". Tests inject.
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  // GET /jobs : every job for the dashboard list (newest first by service convention).
  async listJobs(): Promise<Job[]> {
    const res = await this.fetchImpl(joinUrl(this.baseUrl, "/jobs"), {
      method: "GET",
      headers: { accept: "application/json" },
    });
    const body = await this.parse<Job[] | { jobs?: Job[] }>(res);
    return Array.isArray(body) ? body : body.jobs ?? [];
  }

  // GET /jobs/:id : one job with per-stage detail (status/cost/assetId), for the live processing dashboard
  // and the review queue. Resumable: re-reading the same id returns the latest stage state.
  async getJob(jobId: string): Promise<Job> {
    const res = await this.fetchImpl(joinUrl(this.baseUrl, `/jobs/${encodeURIComponent(jobId)}`), {
      method: "GET",
      headers: { accept: "application/json" },
    });
    return this.parse<Job>(res);
  }

  // POST /produce : enqueue the auto-produce fan-out for one episode. The executor runs async; this returns
  // immediately with the job id, the plan, and the estimated cost (under the cost gate).
  async produce(body: ProduceRequest): Promise<ProduceResponse> {
    const res = await this.fetchImpl(joinUrl(this.baseUrl, "/produce"), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    return this.parse<ProduceResponse>(res);
  }

  private async parse<T>(res: Response): Promise<T> {
    let json: unknown = undefined;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const apiError = (json as { error?: string } | undefined)?.error;
      throw new IngestionApiError(res.status, apiError);
    }
    return json as T;
  }
}

// Resolve the ingestion base URL from the Vite env (VITE_INGESTION_BASE_URL), same-origin default so the
// dev proxy can route /jobs and /produce by prefix. No secrets here, only a public origin.
export function resolveIngestionBaseUrl(env?: Record<string, string | undefined>): string {
  const source = env ?? readImportMetaEnv();
  const fromEnv = source?.VITE_INGESTION_BASE_URL;
  return fromEnv && fromEnv.length > 0 ? fromEnv : "";
}

function readImportMetaEnv(): Record<string, string | undefined> | undefined {
  try {
    return import.meta.env as unknown as Record<string, string | undefined>;
  } catch {
    return undefined;
  }
}
