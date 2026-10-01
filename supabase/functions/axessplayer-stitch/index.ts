// AXESSPLAYER episode STITCH: concatenate N generated clips into ONE continuous vertical mp4 via Rendi
// (ffmpeg-as-a-service, RENDI_API_KEY). Each clip is normalized to 720x1280 24fps then concatenated, so a
// continuous ~90s episode is one file, not loose fragments. The result is re-hosted to public
// videos/axessplayer/episodes for a durable URL. action start -> returns a Rendi command id; action status
// -> polls + on success re-hosts and returns the durable url. No em dashes.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const RENDI = "https://api.rendi.dev/v1";

function uuid(): string {
  return crypto.randomUUID();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const key = Deno.env.get("RENDI_API_KEY");
    if (!key) return json(400, { error: "RENDI_API_KEY not set" });
    const rh = { "X-API-KEY": key, "Content-Type": "application/json" };
    const body = (await req.json()) as Record<string, unknown>;
    const action = body.action;

    if (action === "start") {
      const clips = Array.isArray(body.clips) ? (body.clips as string[]) : [];
      if (clips.length < 2) return json(400, { error: "need at least 2 clips to stitch" });
      const W = 720, H = 1280, FPS = 24;
      const inputs: Record<string, string> = {};
      const parts: string[] = [];
      const labels: string[] = [];
      clips.forEach((url, i) => {
        inputs[`in_${i}`] = url;
        // normalize each clip so concat is clean even if sources differ slightly
        parts.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS}[v${i}]`);
        labels.push(`[v${i}]`);
      });
      const filter = `${parts.join(";")};${labels.join("")}concat=n=${clips.length}:v=1:a=0[outv]`;
      const inputArgs = clips.map((_, i) => `-i {{in_${i}}}`).join(" ");
      const ffmpeg = `${inputArgs} -filter_complex "${filter}" -map "[outv]" -c:v libx264 -pix_fmt yuv420p -r ${FPS} {{out_1}}`;
      const res = await fetch(`${RENDI}/run-ffmpeg-command`, {
        method: "POST",
        headers: rh,
        body: JSON.stringify({ input_files: inputs, output_files: { out_1: "episode.mp4" }, ffmpeg_command: ffmpeg }),
      });
      if (!res.ok) return json(502, { error: "rendi_submit_failed", details: (await res.text()).slice(0, 300) });
      const j = (await res.json()) as Record<string, unknown>;
      const cmdId = (j.command_id ?? j.commandId ?? j.id) as string | undefined;
      if (!cmdId) return json(502, { error: "rendi_no_command_id", raw: JSON.stringify(j).slice(0, 200) });
      return json(200, { id: cmdId, status: "PROCESSING" });
    }

    if (action === "status") {
      const id = String(body.id ?? "");
      if (!id) return json(400, { error: "id required" });
      const res = await fetch(`${RENDI}/commands/${id}`, { headers: rh });
      if (!res.ok) return json(502, { error: "rendi_status_failed", details: (await res.text()).slice(0, 300) });
      const j = (await res.json()) as Record<string, unknown>;
      const status = String(j.status ?? "").toUpperCase();
      if (status === "SUCCESS" || status === "SUCCEEDED" || status === "COMPLETED") {
        const outs = (j.output_files ?? {}) as Record<string, { storage_url?: string }>;
        const rendiUrl = outs.out_1?.storage_url ?? (Object.values(outs)[0]?.storage_url);
        if (!rendiUrl) return json(502, { error: "rendi_no_output", raw: JSON.stringify(j).slice(0, 200) });
        // re-host to durable public storage
        const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
        const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
        const vid = await fetch(rendiUrl);
        const bytes = new Uint8Array(await vid.arrayBuffer());
        const path = `axessplayer/episodes/${uuid()}.mp4`;
        const up = await fetch(`${supabaseUrl}/storage/v1/object/videos/${path}`, {
          method: "POST",
          headers: { authorization: `Bearer ${srk}`, apikey: srk, "content-type": "video/mp4", "x-upsert": "true" },
          body: bytes,
        });
        const durable = up.ok || up.status === 200 ? `${supabaseUrl}/storage/v1/object/public/videos/${path}` : rendiUrl;
        return json(200, { status: "SUCCESS", url: durable });
      }
      if (status === "FAILED" || status === "ERROR") return json(502, { error: "rendi_failed", raw: JSON.stringify(j).slice(0, 300) });
      return json(200, { status: "PROCESSING" });
    }

    return json(400, { error: "invalid action (use start|status)" });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
