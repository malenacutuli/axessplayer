// AXESSPLAYER Seedance 2.0 (api.seedance2.ai). Additive. Reads SEEDANCE_API_KEY. Async create + poll mapped
// to the start/status contract the generation service uses. Supports text-to-video, image-to-video (1-2
// frames), and reference-to-video (up to 9 reference images + up to 3 videos + up to 3 audios) for character
// lock. Returns the last-frame URL for first-last-frame chaining. No em dashes.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const BASE = "https://api.seedance2.ai";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const key = Deno.env.get("SEEDANCE_API_KEY");
    if (!key) return json(400, { error: "SEEDANCE_API_KEY is not set" });
    const h = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    const body = (await req.json()) as Record<string, unknown>;
    const action = body.action;

    if (action === "start") {
      const prompt = String(body.prompt ?? "").slice(0, 5000);
      if (!prompt) return json(400, { error: "prompt required" });
      const arr = (v: unknown, n: number) => (Array.isArray(v) ? (v as string[]).filter((u) => typeof u === "string" && u.length > 0).slice(0, n) : []);
      const imageUrls = arr(body.imageUrls, 9);
      const videoUrls = arr(body.videoUrls, 3);
      const audioUrls = arr(body.audioUrls, 3);
      const durRaw = typeof body.duration === "number" ? body.duration : 5;
      const duration = Math.max(4, Math.min(15, Math.round(durRaw)));
      // Mode: explicit override, else infer. references (videos/audios or >2 images) -> reference-to-video.
      let generationType = typeof body.generationType === "string" ? body.generationType : "";
      if (!generationType) {
        if (videoUrls.length > 0 || audioUrls.length > 0 || imageUrls.length > 2) generationType = "reference-to-video";
        else if (imageUrls.length > 0) generationType = "image-to-video";
        else generationType = "text-to-video";
      }
      const input: Record<string, unknown> = {
        prompt,
        generation_type: generationType,
        duration,
        aspect_ratio: typeof body.aspectRatio === "string" ? body.aspectRatio : "9:16",
        resolution: typeof body.resolution === "string" ? body.resolution : "720p",
        generate_audio: body.generateAudio === true,
        watermark: false,
        return_last_frame: body.returnLastFrame !== false,
        seed: typeof body.seed === "number" ? body.seed : -1,
      };
      // image-to-video takes 1-2 frames; reference-to-video takes up to 9.
      if (imageUrls.length > 0) input.image_urls = generationType === "image-to-video" ? imageUrls.slice(0, 2) : imageUrls;
      if (generationType === "reference-to-video") {
        if (videoUrls.length > 0) input.video_urls = videoUrls;
        if (audioUrls.length > 0) input.audio_urls = audioUrls;
      }
      const res = await fetch(`${BASE}/v1/videos/generations`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ model: typeof body.model === "string" ? body.model : "seedance-2-0", input }),
      });
      if (!res.ok) return json(502, { error: "seedance_create_failed", details: (await res.text()).slice(0, 400) });
      const j = (await res.json()) as Record<string, unknown>;
      const id = (j.taskId ?? j.task_id ?? j.id) as string | undefined;
      if (!id) return json(502, { error: "seedance_no_task_id", raw: JSON.stringify(j).slice(0, 200) });
      return json(200, { id, status: "PENDING", credits: j.credits ?? null });
    }

    if (action === "status") {
      const id = String(body.id ?? "");
      if (!id) return json(400, { error: "id required" });
      const res = await fetch(`${BASE}/v1/tasks/${id}`, { headers: h });
      if (!res.ok) return json(502, { error: "seedance_status_failed", details: (await res.text()).slice(0, 400) });
      const j = (await res.json()) as Record<string, unknown>;
      const status = String(j.status ?? "").toLowerCase();
      if (status === "completed") {
        const data = (j.data ?? {}) as Record<string, unknown>;
        const results = Array.isArray(data.results) ? (data.results as string[]) : [];
        const videoUrl = results[0] ?? null;
        if (!videoUrl) return json(502, { error: "seedance_no_result" });
        return json(200, { status: "SUCCEEDED", videoUrl, lastFrameUrl: data.last_frame_url ?? null });
      }
      if (status === "failed") return json(200, { status: "FAILED", error: j.failed_reason ?? "failed" });
      return json(200, { status: "PENDING" });
    }

    return json(400, { error: "invalid action (use start|status)" });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
