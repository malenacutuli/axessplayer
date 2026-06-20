// PROMPT 26 real backends, behind the cost gate. These wrap the Supabase edge functions the way
// services/ingestion/src/produceRuntime.ts does. They are DORMANT by default: server.ts only wires them when
// GENERATION_REAL_BACKEND=1, and even then /generate is refused unless GENERATION_ALLOW_REAL_SPEND=1 (the
// human cost sign-off). The default deploy uses the deterministic FakeProviderClient instead, so QA spends
// nothing. Model ids/params here are FLAGGED 2026 placeholders, re-verify at build time. No em dashes.

import type { ProviderClient, ProviderRequest, Submission, RawProviderOutput } from "./router.js";
import type { ConsistencyScorer, ReferenceSet, ShotScore } from "./consistency.js";
import type { ConsentGate, ConsentState } from "./consentGate.js";

export interface EdgeConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
}

// Read the edge config (the Supabase project + service-role key the edge functions need). Null when either
// is missing, which keeps the real backend off.
export function readEdgeConfig(env: NodeJS.ProcessEnv = process.env): EdgeConfig | null {
  const supabaseUrl = (env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) return null;
  return { supabaseUrl, serviceRoleKey };
}

class ProviderNotWiredError extends Error {
  constructor(provider: string) {
    super(`real provider not wired: ${provider}. Only the Runway video path has a live edge function today; ` + `wire the rest at the BUY->BUILD cutover.`);
    this.name = "ProviderNotWiredError";
  }
}

// The REAL provider client. Today it wires the one live video-generation edge function (Runway
// prompt-to-video, action start/status = submit-poll); other providers throw a clear not-wired error so a
// misrouted real run fails loud rather than silently degrading. Adding a provider is one case here plus a
// registry entry, never a change to the router.
export function makeEdgeProviderClient(cfg: EdgeConfig, fetchFn: typeof fetch = fetch): ProviderClient {
  const headers = {
    authorization: `Bearer ${cfg.serviceRoleKey}`,
    apikey: cfg.serviceRoleKey,
    "content-type": "application/json",
  };
  const fn = (name: string) => `${cfg.supabaseUrl}/functions/v1/${name}`;
  const post = async (name: string, body: unknown): Promise<Record<string, unknown>> => {
    const res = await fetchFn(fn(name), { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${name} -> ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return (await res.json()) as Record<string, unknown>;
  };

  return {
    async submit(req: ProviderRequest): Promise<Submission> {
      if (req.model.provider === "runway") {
        const out = await post("prompt-to-video", {
          action: "start",
          promptText: req.params.prompt ?? "",
          model: req.model.model_id,
          duration: req.params.durationS ?? req.model.maxDurationS ?? 5,
          // First-last-frame continuation: pass the anchor frame when chaining.
          ...(typeof req.params.anchorUrl === "string" ? { initImage: req.params.anchorUrl } : {}),
        });
        const taskId = (out.taskId ?? out.id ?? out.task_id) as string | undefined;
        if (!taskId) throw new Error("prompt-to-video: no task id returned");
        return { status: "pending", handle: `runway:${taskId}` };
      }
      throw new ProviderNotWiredError(req.model.provider);
    },
    async poll(handle: string): Promise<Submission> {
      const [provider, taskId] = handle.split(":");
      if (provider !== "runway") throw new ProviderNotWiredError(provider);
      const out = await post("prompt-to-video", { action: "status", taskId });
      const status = String(out.status ?? "").toUpperCase();
      if (status === "SUCCEEDED" || status === "DONE" || status === "COMPLETED") {
        const url = (out.outputUrl ?? out.output ?? (Array.isArray(out.output) ? out.output[0] : undefined)) as string | undefined;
        if (!url) throw new Error("prompt-to-video: succeeded with no output url");
        const result: RawProviderOutput = { outputUrl: url, raw: out };
        return { status: "done", output: result };
      }
      if (status === "FAILED" || status === "ERROR") throw new Error(`prompt-to-video failed: ${JSON.stringify(out).slice(0, 160)}`);
      return { status: "pending", handle };
    },
  };
}

// ---------- real consistency scorer ----------
// HONEST PLACEHOLDER: there is no deployed ArcFace/ViCLIP embedding edge function yet, so a true face/scene
// cosine cannot be computed server-side today. Rather than fake an always-pass, this scorer derives a stable
// pseudo-score in [0,1] from the output url + the reference vectors. It varies per shot (so reject/retry is
// exercised) and is deterministic (so a re-run is reproducible). Swap for a real embedder edge function
// (EMBED_FACE_FN / EMBED_SCENE_FN) at the identity cutover; the port does not change.
export function makeEdgeScorer(_cfg: EdgeConfig): ConsistencyScorer {
  return {
    async scoreShot(outputUrl: string, refs: ReferenceSet): Promise<ShotScore> {
      const faceCosine = refs.face && refs.face.length > 0 ? pseudoScore(outputUrl + "|face|" + refs.face.length) : null;
      const sceneScore = refs.scene && refs.scene.length > 0 ? pseudoScore(outputUrl + "|scene|" + refs.scene.length) : null;
      return { faceCosine, sceneScore };
    },
  };
}

// ---------- real consent gate (HTTP to services/trust) ----------
// services/trust owns the tamper-evident consent_ledger. Expected contract: GET {base}/consent/status?ref=<ref>
// returns { current: boolean }. On any error or non-200 the gate returns current=false (fail CLOSED: a
// likeness generation is blocked when consent cannot be confirmed).
export function makeTrustConsentGate(baseUrl: string, fetchFn: typeof fetch = fetch): ConsentGate {
  const base = baseUrl.replace(/\/$/, "");
  return {
    async status(consentRef: string | null | undefined): Promise<ConsentState> {
      if (consentRef == null || consentRef === "") return { current: false };
      try {
        const res = await fetchFn(`${base}/consent/status?ref=${encodeURIComponent(consentRef)}`, {
          method: "GET",
          headers: { accept: "application/json" },
        });
        if (!res.ok) return { current: false };
        const body = (await res.json()) as { current?: unknown };
        return { current: body.current === true };
      } catch {
        return { current: false };
      }
    },
  };
}

// A stable pseudo-score in [0,1] from a string (djb2), biased high so most shots pass and some fail, which
// exercises the reject/retry path deterministically.
function pseudoScore(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  // Map to [0.35, 1.0]: a spread that produces occasional sub-threshold scores.
  return 0.35 + (h % 1000) / 1000 * 0.65;
}
