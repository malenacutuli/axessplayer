// AXESSPLAYER text-to-video via Runway's CURRENT API (api.dev.runwayml.com). Additive; does NOT touch the
// stale Axessible prompt-to-video fn. Runway has no direct text-to-video: text_to_image (gen4_image) ->
// image_to_video (gen4_turbo). 'start' generates the first frame then kicks the video task; 'status' polls.
// promptText is clamped to 1000 chars (Runway's hard limit). No em dashes.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const RUNWAY = "https://api.dev.runwayml.com";
const VERSION = "2024-11-06";
const MAX_PROMPT = 990; // Runway promptText hard limit is 1000

function headers(key: string) {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Runway-Version": VERSION };
}

async function poll(taskId: string, key: string, maxMs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + maxMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await fetch(`${RUNWAY}/v1/tasks/${taskId}`, { headers: headers(key) });
    if (!r.ok) throw new Error(`task ${taskId} -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const t = (await r.json()) as Record<string, unknown>;
    const status = String(t.status ?? "").toUpperCase();
    if (status === "SUCCEEDED") return t;
    if (status === "FAILED" || status === "CANCELLED") throw new Error(`task ${taskId} ${status}: ${JSON.stringify(t).slice(0, 200)}`);
    if (Date.now() > deadline) throw new Error(`task ${taskId} timed out in ${maxMs}ms`);
    await new Promise((res) => setTimeout(res, 3000));
  }
}

function firstOutput(t: Record<string, unknown>): string | null {
  const out = t.output;
  if (Array.isArray(out) && out.length > 0 && typeof out[0] === "string") return out[0];
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const key = Deno.env.get("RUNWAYML_API_KEY");
    if (!key) return json(400, { error: "RUNWAYML_API_KEY is not set" });
    const body = (await req.json()) as Record<string, unknown>;
    const action = body.action;

    if (action === "start") {
      const prompt = String(body.prompt ?? "").slice(0, MAX_PROMPT);
      if (!prompt) return json(400, { error: "prompt required" });
      const videoRatio = typeof body.ratio === "string" ? body.ratio : "720:1280";
      const duration = typeof body.duration === "number" ? body.duration : 5;

      let promptImage = typeof body.promptImage === "string" ? body.promptImage : "";
      if (!promptImage) {
        const imgRes = await fetch(`${RUNWAY}/v1/text_to_image`, {
          method: "POST",
          headers: headers(key),
          body: JSON.stringify({ model: "gen4_image", promptText: prompt, ratio: "1080:1920" }),
        });
        if (!imgRes.ok) return json(502, { error: "runway_text_to_image_failed", details: (await imgRes.text()).slice(0, 300) });
        const imgTask = (await imgRes.json()) as Record<string, unknown>;
        const done = await poll(String(imgTask.id), key, 110000);
        promptImage = firstOutput(done) ?? "";
        if (!promptImage) return json(502, { error: "runway_image_no_output" });
      }

      const vidRes = await fetch(`${RUNWAY}/v1/image_to_video`, {
        method: "POST",
        headers: headers(key),
        body: JSON.stringify({ model: "gen4_turbo", promptImage, promptText: prompt, ratio: videoRatio, duration }),
      });
      if (!vidRes.ok) return json(502, { error: "runway_image_to_video_failed", details: (await vidRes.text()).slice(0, 300) });
      const vidTask = (await vidRes.json()) as Record<string, unknown>;
      return json(200, { id: vidTask.id, status: "PENDING", promptImage });
    }

    if (action === "status") {
      const id = String(body.id ?? "");
      if (!id) return json(400, { error: "id required" });
      const r = await fetch(`${RUNWAY}/v1/tasks/${id}`, { headers: headers(key) });
      if (!r.ok) return json(502, { error: "runway_status_failed", details: (await r.text()).slice(0, 300) });
      const t = (await r.json()) as Record<string, unknown>;
      return json(200, { status: t.status, videoUrl: firstOutput(t), progress: t.progress ?? null });
    }

    return json(400, { error: "invalid action (use start|status)" });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
