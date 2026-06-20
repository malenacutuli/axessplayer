// Studio client for the live generation engine (prompt 26): POST /generate runs a brief through the
// model-agnostic router + consistency QA + the consent + cost gates and returns the accepted shot, the
// attempt log, and the QA pass-rate. Reads VITE_GENERATION_BASE_URL + the creator session token. The default
// deployed backend is the deterministic fake (no real spend); real model spend is gated server-side. No em dashes.

type EnvBag = Record<string, string | undefined>;

function readEnv(): EnvBag {
  try {
    return (import.meta as unknown as { env?: EnvBag }).env ?? {};
  } catch {
    return {};
  }
}

export interface GenerationConfig {
  baseUrl: string;
  token: string;
}

export function generationConfig(env: EnvBag = readEnv()): GenerationConfig | null {
  const baseUrl = env.VITE_GENERATION_BASE_URL?.trim();
  const token = env.VITE_CREATOR_SESSION_TOKEN?.trim() ?? env.VITE_SESSION_TOKEN?.trim();
  if (!baseUrl || !token) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), token };
}

export function isGenerationConfigured(): boolean {
  return generationConfig() != null;
}

export interface ShotAttempt {
  attempt: number;
  provider: string;
  modelHandle: string;
  pass: boolean;
  reason: string;
  score: { faceCosine: number | null; sceneScore: number | null } | null;
  costUsd: number;
  cached: boolean;
}

export interface GenerateShotResult {
  specId: string;
  accepted: { outputUrl: string; provider: string; model_id: string } | null;
  attempts: ShotAttempt[];
  passRate: number;
  paused: boolean;
  pauseReason?: string;
  spentUsd: number;
  blocked?: { reason: string };
}

export class GenerationError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GenerationError";
    this.status = status;
  }
}

export interface GenerateShotInput {
  specId: string;
  seriesId: string;
  prompt: string;
  durationS?: number;
  shotCount?: number;
  tier?: "A_filmed" | "B_likeness" | "C_ai";
  characterRef?: string | null;
  consentRef?: string | null;
  budgetUsd?: number;
  preview?: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Run one consistency-checked shot generation against the live engine. Real video generation is async and
// takes 60-120s: POST /generate kicks it and returns 202; this then polls GET /generate/:specId until done.
export async function generateShot(
  input: GenerateShotInput,
  opts: { fetchImpl?: typeof fetch; pollMs?: number; maxPolls?: number } = {},
): Promise<GenerateShotResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cfg = generationConfig();
  if (!cfg) throw new GenerationError(0, "Generation is not configured for this build (set VITE_GENERATION_BASE_URL).");
  const headers = { "content-type": "application/json", authorization: `Bearer ${cfg.token}`, accept: "application/json" };

  const start = await fetchImpl(`${cfg.baseUrl}/generate`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      specId: input.specId,
      seriesId: input.seriesId,
      tier: input.tier ?? "C_ai",
      characterRef: input.characterRef ?? null,
      consentRef: input.consentRef ?? null,
      realLikeness: input.tier === "B_likeness",
      brief: {
        modality: "video",
        durationS: input.durationS ?? 5,
        ...(input.shotCount ? { shotCount: input.shotCount } : {}),
        ...(input.preview ? { preview: true } : {}),
      },
      params: { prompt: input.prompt },
      ...(input.budgetUsd ? { budgetUsd: input.budgetUsd } : {}),
    }),
  });
  const startBody = (await start.json().catch(() => ({}))) as Record<string, unknown>;
  if (start.status === 403 && startBody.error === "consent_blocked") {
    return { specId: input.specId, accepted: null, attempts: [], passRate: 0, paused: false, spentUsd: 0, blocked: { reason: String(startBody.reason ?? "consent") } };
  }
  if (start.status !== 202 && !start.ok) throw new GenerationError(start.status, String(startBody.error ?? `error_${start.status}`));

  // Poll the result.
  const pollMs = opts.pollMs ?? 4000;
  const maxPolls = opts.maxPolls ?? 60;
  for (let i = 0; i < maxPolls; i++) {
    await sleep(pollMs);
    const res = await fetchImpl(`${cfg.baseUrl}/generate/${encodeURIComponent(input.specId)}`, { headers });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.status === "done") return body as unknown as GenerateShotResult;
    if (body.status === "failed") throw new GenerationError(500, String(body.error ?? "generation_failed"));
    // running or unknown -> keep polling
  }
  throw new GenerationError(408, "Generation is taking longer than expected. Check back shortly.");
}
