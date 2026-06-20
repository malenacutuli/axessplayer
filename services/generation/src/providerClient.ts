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
  apiKey: string; // service-role key if available, else the anon key (both pass verify_jwt + the scoped RLS)
}

// Read the edge config. Prefers the service-role key, falls back to the anon key (the axessplayer-runway-video
// fn is verify_jwt and the storage RLS allows anon writes under videos/axessplayer/**, so anon suffices).
// Null when no key is available, which keeps the real backend off.
export function readEdgeConfig(env: NodeJS.ProcessEnv = process.env): EdgeConfig | null {
  const supabaseUrl = (env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const apiKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || "";
  if (!supabaseUrl || !apiKey) return null;
  return { supabaseUrl, apiKey };
}

class ProviderNotWiredError extends Error {
  constructor(provider: string) {
    super(`real provider not wired: ${provider}. Only the Runway video path has a live edge function today; ` + `wire the rest at the BUY->BUILD cutover.`);
    this.name = "ProviderNotWiredError";
  }
}

function uuid(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (c) => ((Math.random() * 16) | 0).toString(16));
}

// The REAL provider client. Wires the live Runway text-to-video path (axessplayer-runway-video, the corrected
// api.dev.runwayml.com two-step) as submit-poll. On success it RE-HOSTS the video into the public
// videos/axessplayer/generated bucket (Runway output URLs are signed and expire), so the returned playback URL
// is durable. Other providers throw a clear not-wired error so a misroute fails loud.
export function makeEdgeProviderClient(cfg: EdgeConfig, fetchFn: typeof fetch = fetch): ProviderClient {
  const headers = { authorization: `Bearer ${cfg.apiKey}`, apikey: cfg.apiKey, "content-type": "application/json" };
  const fn = (name: string) => `${cfg.supabaseUrl}/functions/v1/${name}`;
  const post = async (name: string, body: unknown): Promise<Record<string, unknown>> => {
    const res = await fetchFn(fn(name), { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${name} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as Record<string, unknown>;
  };

  // Download the ephemeral Runway mp4 and upload it to the public videos/axessplayer/generated bucket, returning
  // a durable public URL. Best-effort: if the re-host fails, fall back to the ephemeral URL so the run still
  // returns a (short-lived) playable asset rather than failing.
  const rehost = async (videoUrl: string): Promise<string> => {
    try {
      const vid = await fetchFn(videoUrl);
      if (!vid.ok) return videoUrl;
      const bytes = new Uint8Array(await vid.arrayBuffer());
      const path = `axessplayer/generated/${uuid()}.mp4`;
      const up = await fetchFn(`${cfg.supabaseUrl}/storage/v1/object/videos/${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.apiKey}`, apikey: cfg.apiKey, "content-type": "video/mp4", "x-upsert": "true" },
        body: bytes,
      });
      if (!up.ok && up.status !== 200) return videoUrl;
      return `${cfg.supabaseUrl}/storage/v1/object/public/videos/${path}`;
    } catch {
      return videoUrl;
    }
  };

  return {
    async submit(req: ProviderRequest): Promise<Submission> {
      if (req.model.provider === "runway") {
        const out = await post("axessplayer-runway-video", {
          action: "start",
          prompt: req.params.prompt ?? "",
          duration: req.params.durationS ?? req.model.maxDurationS ?? 5,
          ratio: "720:1280", // vertical 9:16
          // First-last-frame continuation: seed the next segment on the anchor frame when chaining.
          ...(typeof req.params.anchorUrl === "string" ? { promptImage: req.params.anchorUrl } : {}),
        });
        const id = out.id as string | undefined;
        if (!id) throw new Error(`runway start returned no id: ${JSON.stringify(out).slice(0, 160)}`);
        return { status: "pending", handle: `runway:${id}` };
      }
      throw new ProviderNotWiredError(req.model.provider);
    },
    async poll(handle: string): Promise<Submission> {
      const [provider, id] = handle.split(":");
      if (provider !== "runway") throw new ProviderNotWiredError(provider);
      const out = await post("axessplayer-runway-video", { action: "status", id });
      const status = String(out.status ?? "").toUpperCase();
      if (status === "SUCCEEDED") {
        const ephemeral = out.videoUrl as string | undefined;
        if (!ephemeral) throw new Error("runway succeeded with no video url");
        const durable = await rehost(ephemeral);
        return { status: "done", output: { outputUrl: durable, raw: out } as RawProviderOutput };
      }
      if (status === "FAILED" || status === "CANCELLED" || status === "ERROR") {
        throw new Error(`runway failed: ${JSON.stringify(out).slice(0, 160)}`);
      }
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
