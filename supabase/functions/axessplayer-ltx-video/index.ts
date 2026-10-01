// AXESSPLAYER LTX-2.3 renderer (api.ltx.video, async v2). Additive. Reads LTX_API_KEY (with fallbacks).
// Maps the LTX async submit+poll API to the start/status contract the generation service's ProviderClient
// uses (same shape as axessplayer-seedance-video). text-to-video and image-to-video (image_uri first-frame
// for cross-provider chaining); native joint audio on by default; vertical 9:16 default. LTX async returns a
// google storage video_url which the caller re-hosts to a durable bucket. No em dashes.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { requireService } from "../_shared/auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const BASE = "https://api.ltx.video";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const denied = requireService(req, cors);
  if (denied) return denied;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const key = Deno.env.get("LTX_API_KEY") ?? Deno.env.get("LTXV_API_KEY") ?? Deno.env.get("LTX_KEY");
    if (!key) return json(400, { error: "LTX_API_KEY is not set" });
    const h = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    const body = (await req.json()) as Record<string, unknown>;
    const action = body.action;

    if (action === "start") {
      const prompt = String(body.prompt ?? "").slice(0, 5000);
      if (!prompt) return json(400, { error: "prompt required" });
      // LTX-2.3 models: ltx-2-3-fast (distilled, cheap) | ltx-2-3-pro (full quality).
      const model = typeof body.model === "string" && body.model.length > 0 ? body.model : "ltx-2-3-fast";
      // Duration in whole seconds; LTX stable window is short, the caller keeps shots <= ~7s, cap at 20.
      const duration = Math.max(1, Math.min(20, Math.round(typeof body.duration === "number" ? body.duration : 5)));
      // Vertical 9:16 by default for the feed.
      const resolution = typeof body.resolution === "string" && body.resolution.length > 0 ? body.resolution : "1080x1920";
      const fps = typeof body.fps === "number" ? body.fps : 24;
      const generateAudio = body.generateAudio !== false; // native joint audio on by default
      const imageUri = typeof body.imageUri === "string" && body.imageUri.length > 0 ? body.imageUri : "";
      // image-to-video when a first-frame anchor is supplied (chaining), else text-to-video.
      const endpoint = imageUri ? "image-to-video" : "text-to-video";
      const reqBody: Record<string, unknown> = { model, prompt, duration, resolution, fps, generate_audio: generateAudio };
      if (imageUri) reqBody.image_uri = imageUri;
      if (typeof body.cameraMotion === "string" && body.cameraMotion.length > 0) reqBody.camera_motion = body.cameraMotion;
      if (typeof body.negativePrompt === "string" && body.negativePrompt.length > 0) reqBody.negative_prompt = body.negativePrompt;
      const res = await fetch(`${BASE}/v2/${endpoint}`, { method: "POST", headers: h, body: JSON.stringify(reqBody) });
      if (!res.ok) return json(502, { error: "ltx_create_failed", details: (await res.text()).slice(0, 400) });
      const j = (await res.json()) as Record<string, unknown>;
      const id = (j.id ?? j.job_id ?? j.task_id) as string | undefined;
      if (!id) return json(502, { error: "ltx_no_id", raw: JSON.stringify(j).slice(0, 200) });
      return json(200, { id, status: "PENDING", endpoint });
    }

    if (action === "status") {
      const id = String(body.id ?? "");
      if (!id) return json(400, { error: "id required" });
      const endpoint = typeof body.endpoint === "string" && body.endpoint.length > 0 ? body.endpoint : "text-to-video";
      const res = await fetch(`${BASE}/v2/${endpoint}/${id}`, { headers: h });
      if (!res.ok) return json(502, { error: "ltx_status_failed", details: (await res.text()).slice(0, 400) });
      const j = (await res.json()) as Record<string, unknown>;
      const status = String(j.status ?? "").toLowerCase();
      if (status === "completed" || status === "succeeded") {
        const result = (j.result ?? {}) as Record<string, unknown>;
        const videoUrl = (result.video_url ?? result.videoUrl ?? j.video_url ?? null) as string | null;
        if (!videoUrl) return json(502, { error: "ltx_no_result", raw: JSON.stringify(j).slice(0, 200) });
        return json(200, { status: "SUCCEEDED", videoUrl, lastFrameUrl: (result.last_frame_url ?? result.lastFrameUrl ?? null) as string | null });
      }
      if (status === "failed" || status === "error" || status === "cancelled") {
        return json(200, { status: "FAILED", error: j.error ?? j.failure_reason ?? j.failed_reason ?? "failed" });
      }
      return json(200, { status: "PENDING" });
    }

    return json(400, { error: "invalid action (use start|status)" });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
