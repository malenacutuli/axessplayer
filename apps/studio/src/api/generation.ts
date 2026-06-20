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

// Run one consistency-checked shot generation against the live engine.
export async function generateShot(input: GenerateShotInput, fetchImpl: typeof fetch = fetch): Promise<GenerateShotResult> {
  const cfg = generationConfig();
  if (!cfg) throw new GenerationError(0, "Generation is not configured for this build (set VITE_GENERATION_BASE_URL).");
  const res = await fetchImpl(`${cfg.baseUrl}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}`, accept: "application/json" },
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
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 403 && body.error === "consent_blocked") {
    return { specId: input.specId, accepted: null, attempts: [], passRate: 0, paused: false, spentUsd: 0, blocked: { reason: String(body.reason ?? "consent") } };
  }
  if (!res.ok) throw new GenerationError(res.status, String(body.error ?? `error_${res.status}`));
  return body as unknown as GenerateShotResult;
}
