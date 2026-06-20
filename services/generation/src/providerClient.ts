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
        // Runway gen4_turbo accepts only duration 5 or 10. Clamp (the brief duration is threaded via params).
        const reqDur = typeof req.params.durationS === "number" ? req.params.durationS : 5;
        const duration = reqDur >= 8 ? 10 : 5;
        const out = await post("axessplayer-runway-video", {
          action: "start",
          prompt: req.params.prompt ?? "",
          duration,
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

// ---------- episode stitch client (Rendi concat via axessplayer-stitch) ----------
export interface StitchClient {
  stitch(clips: string[]): Promise<string>; // returns the durable continuous-episode URL
}

// Calls the axessplayer-stitch edge fn (start + poll) to concatenate clips into one continuous mp4.
export function makeStitchClient(cfg: EdgeConfig, fetchFn: typeof fetch = fetch): StitchClient {
  const headers = { authorization: `Bearer ${cfg.apiKey}`, apikey: cfg.apiKey, "content-type": "application/json" };
  const fn = `${cfg.supabaseUrl}/functions/v1/axessplayer-stitch`;
  return {
    async stitch(clips: string[]): Promise<string> {
      if (clips.length === 1) return clips[0];
      const start = await fetchFn(fn, { method: "POST", headers, body: JSON.stringify({ action: "start", clips }) });
      if (!start.ok) throw new Error(`stitch start -> ${start.status}: ${(await start.text()).slice(0, 200)}`);
      const id = ((await start.json()) as { id?: string }).id;
      if (!id) throw new Error("stitch returned no command id");
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const res = await fetchFn(fn, { method: "POST", headers, body: JSON.stringify({ action: "status", id }) });
        const body = (await res.json()) as { status?: string; url?: string; error?: string };
        if (body.status === "SUCCESS" && body.url) return body.url;
        if (body.error) throw new Error(`stitch failed: ${body.error}`);
      }
      throw new Error("stitch did not finish in time");
    },
  };
}

// ---------- scene expander (premise -> N scene prompts via an LLM edge fn) ----------
export interface SceneExpander {
  expand(premise: string, count: number, style: string): Promise<string[]>;
}

// Uses the google-gemini edge fn to expand a premise into N short, continuous scene descriptions. Robust:
// on any failure it falls back to repeating the premise so the episode still generates.
export function makeSceneExpander(cfg: EdgeConfig, fetchFn: typeof fetch = fetch): SceneExpander {
  const headers = { authorization: `Bearer ${cfg.apiKey}`, apikey: cfg.apiKey, "content-type": "application/json" };
  return {
    async expand(premise: string, count: number, style: string): Promise<string[]> {
      const ask =
        `${style}\n\nBreak this premise into exactly ${count} consecutive ~5 second shot descriptions for a ` +
        `continuous vertical episode, in order, each on its own line as "N. <visual action>", no extra text. ` +
        `Keep the same characters and town across shots for continuity. Premise: ${premise}`;
      try {
        const res = await fetchFn(`${cfg.supabaseUrl}/functions/v1/google-gemini`, {
          method: "POST",
          headers,
          // gemini-1.5-flash is retired (404); use a current model. maxTokens covers ~18 scene lines.
          body: JSON.stringify({ prompt: ask, model: "gemini-2.5-flash", temperature: 0.8, maxTokens: 1400 }),
        });
        if (res.ok) {
          // google-gemini returns the RAW Gemini API shape: candidates[0].content.parts[0].text.
          const j = (await res.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
            text?: string;
            response?: string;
          };
          const text = String(
            j?.candidates?.[0]?.content?.parts?.[0]?.text ?? j?.text ?? j?.response ?? "",
          );
          const lines = text
            .split("\n")
            .map((l) => l.replace(/^\s*\d+[.):\-]\s*/, "").replace(/^["'\s]+|["'\s]+$/g, "").trim())
            .filter((l) => l.length > 8)
            // each shot prompt stays well under Runway's 1000-char limit
            .map((l) => l.slice(0, 600));
          if (lines.length >= 2) return lines.slice(0, count);
        }
      } catch {
        // fall through to fallback
      }
      // Fallback when the LLM is unavailable: split the premise into sentences and pad to `count`, each kept
      // short (never the whole premise, which would blow past Runway's prompt limit and be degenerate).
      const sentences = premise
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim().slice(0, 400))
        .filter((s) => s.length > 8);
      const base = sentences.length >= 2 ? sentences : [premise.slice(0, 400)];
      return Array.from({ length: count }, (_, i) => base[i % base.length]);
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
