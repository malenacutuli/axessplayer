// The REAL I/O adapters that back the produce executor: the Supabase edge-function client, the public
// thumbnails-bucket storage upload, and the content-service track PATCH. Reads SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY + the content base URL from env. These are the only pieces that touch the
// network; produceExecutor.ts stays pure over the injected ports. Running a REAL produce live needs
// SUPABASE_SERVICE_ROLE_KEY set on the deployed ingestion service. No em dashes.

import type { EdgeClient, StoragePort, ContentPort, VariantTrackPatch } from "./produceExecutor.js";

export interface RuntimeConfig {
  supabaseUrl: string; // e.g. https://faeyekynudyzeotbjfsj.supabase.co
  serviceRoleKey: string; // SUPABASE_SERVICE_ROLE_KEY (Bearer + apikey for the edge fns + storage)
  contentBaseUrl: string; // the content service base, e.g. https://content.../
  thumbnailsBucket: string; // public bucket for produced tracks; default "thumbnails"
  storagePrefix: string; // per-variant folder under the bucket, e.g. the variant/media id
}

export function readRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  storagePrefix = "produced"
): RuntimeConfig | { error: string } {
  const supabaseUrl = (env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const contentBaseUrl = (env.CONTENT_BASE_URL ?? env.VITE_CONTENT_BASE_URL ?? "").replace(/\/$/, "");
  if (!supabaseUrl) return { error: "SUPABASE_URL not set" };
  if (!serviceRoleKey) return { error: "SUPABASE_SERVICE_ROLE_KEY not set" };
  if (!contentBaseUrl) return { error: "CONTENT_BASE_URL not set" };
  return {
    supabaseUrl,
    serviceRoleKey,
    contentBaseUrl,
    thumbnailsBucket: env.THUMBNAILS_BUCKET ?? "thumbnails",
    storagePrefix,
  };
}

type FetchFn = typeof fetch;

// The edge-function client. Each call POSTs to <SUPABASE_URL>/functions/v1/<name> with the service-role key
// as both Bearer and apikey, exactly as tools/auto-produce/produce.mjs does.
export function makeEdgeClient(cfg: RuntimeConfig, fetchFn: FetchFn = fetch): EdgeClient {
  const headers = {
    authorization: `Bearer ${cfg.serviceRoleKey}`,
    apikey: cfg.serviceRoleKey,
    "content-type": "application/json",
  };
  const fn = (name: string) => `${cfg.supabaseUrl}/functions/v1/${name}`;
  const postJson = async (name: string, body: unknown): Promise<unknown> => {
    const res = await fetchFn(fn(name), { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${name} -> ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return res.json();
  };
  return {
    // AssemblyAI ASR via the `transcribe` edge fn. The Deepgram key is dead (Invalid credentials); AssemblyAI
    // does the same job and is keyed. Returns { text, segments, utterances, words, language }. No em dashes.
    transcribe: (videoUrl) => postJson("transcribe", { videoUrl, url: videoUrl, language: "en" }),
    dub: async (text, targetLanguage) =>
      (await postJson("generate-dubbing", { text, targetLanguage })) as { translatedText?: string; audioBase64?: string },
    audioDescriptions: (videoUrl) => postJson("twelve-labs-audio-descriptions", { videoUrl, url: videoUrl }),
    // Speaker diarization (AssemblyAI primary) -> speaker-tagged time turns with colors, for CWI captions.
    diarize: async (videoUrl) => {
      const j = (await postJson("speaker-diarization-unified", { videoUrl, url: videoUrl, targetLanguage: "en" })) as {
        segments?: Array<{ startTime?: number; endTime?: number; start?: number; end?: number; speaker?: string; speakerColor?: string }>;
      };
      return (j.segments ?? []).map((s) => ({
        start: s.startTime ?? s.start ?? 0,
        end: s.endTime ?? s.end ?? 0,
        speaker: s.speaker ?? "Speaker",
        color: s.speakerColor ?? "#22E3D0",
      }));
    },
    poster: async (prompt) => {
      const res = await fetchFn(fn("stability-ai"), { method: "POST", headers, body: JSON.stringify({ prompt }) });
      if (!res.ok) throw new Error(`stability-ai -> ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const j = (await res.json()) as Record<string, unknown>;
        const b64 = typeof j.imageBase64 === "string" ? j.imageBase64 : typeof j.image === "string" ? j.image : "";
        if (!b64) throw new Error("stability-ai: no image in JSON response");
        return Uint8Array.from(Buffer.from(b64, "base64"));
      }
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

// Upload to the PUBLIC thumbnails bucket: POST /storage/v1/object/<bucket>/<prefix>/<file> with x-upsert, and
// return the public URL. Mirrors tools/deploy/migrate-media.mjs.
export function makeStorage(cfg: RuntimeConfig, fetchFn: FetchFn = fetch): StoragePort {
  return {
    upload: async (file, bytes, contentType) => {
      const path = `${cfg.storagePrefix}/${file}`;
      const res = await fetchFn(`${cfg.supabaseUrl}/storage/v1/object/${cfg.thumbnailsBucket}/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.serviceRoleKey}`,
          apikey: cfg.serviceRoleKey,
          "content-type": contentType,
          "x-upsert": "true",
        },
        body: Buffer.from(bytes),
      });
      if (!res.ok && res.status !== 200) {
        throw new Error(`upload ${path} -> ${res.status}: ${(await res.text()).slice(0, 140)}`);
      }
      return `${cfg.supabaseUrl}/storage/v1/object/public/${cfg.thumbnailsBucket}/${path}`;
    },
  };
}

// The content-service client: PATCH /variants/:id/tracks (self-healing track attach) and set the series
// poster. Calls the EXISTING content endpoints only.
export function makeContent(cfg: RuntimeConfig, fetchFn: FetchFn = fetch): ContentPort {
  return {
    patchTracks: async (variantId, tracks: VariantTrackPatch) => {
      const res = await fetchFn(`${cfg.contentBaseUrl}/variants/${encodeURIComponent(variantId)}/tracks`, {
        method: "PATCH",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(tracks),
      });
      if (!res.ok) throw new Error(`patchTracks ${variantId} -> ${res.status}: ${(await res.text()).slice(0, 140)}`);
    },
    setSeriesPoster: async (seriesId, posterUrl) => {
      // The content service generates/sets a series poster; pass the produced URL so the feed shows it.
      const res = await fetchFn(`${cfg.contentBaseUrl}/series/${encodeURIComponent(seriesId)}/poster`, {
        method: "PATCH",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ poster_url: posterUrl }),
      });
      // Poster set is best-effort: the produced poster is already uploaded; a non-2xx here does not fail the
      // run (the asset exists in storage), so swallow it and let register/captions remain authoritative.
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.warn(`setSeriesPoster ${seriesId} -> ${res.status} (non-fatal)`);
      }
    },
  };
}
