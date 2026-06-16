// Real master-video upload for the Studio. Streams the chosen file to the local media server
// (tools/media-server), which stores it and serves it back with Range support. The returned URL becomes
// the beat_variant playback_url, so both the Studio preview and the consumer player can actually play the
// uploaded video. Out of scope locally: HLS transcode + CDN (the production generation pipeline). No em
// dashes.

export interface UploadedMaster {
  url: string;
  name: string;
  size: number;
}

export function mediaBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_MEDIA_BASE_URL || "http://127.0.0.1:8095";
}

export type IngestState = "uploading" | "encoding";

export interface IngestResult {
  // The HLS master.m3u8 the encoder produced, ready to play.
  url: string;
  jobId: string;
}

// The REAL ingest lifecycle: upload the master, then poll the encode job until the HLS is ready. Surfaces
// the state (uploading -> encoding) and throws an actionable error on failure (with the ffmpeg reason) or
// timeout. The returned url is the master.m3u8, played via hls.js. No silent states.
export async function uploadAndEncode(
  file: File,
  opts: {
    baseUrl?: string;
    fetch?: typeof globalThis.fetch;
    onState?: (state: IngestState) => void;
    timeoutMs?: number;
    pollMs?: number;
  } = {},
): Promise<IngestResult> {
  const base = (opts.baseUrl ?? mediaBaseUrl()).replace(/\/$/, "");
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  opts.onState?.("uploading");
  let res: Response;
  try {
    res = await doFetch(`${base}/upload/${encodeURIComponent(file.name)}`, {
      method: "PUT",
      headers: file.type ? { "content-type": file.type } : undefined,
      body: file,
    });
  } catch {
    throw new Error(`media server not reachable at ${base} - run: node tools/media-server/server.mjs`);
  }
  if (!res.ok) throw new Error(`upload failed (${res.status})`);
  const { job_id: jobId } = (await res.json()) as { job_id: string };

  opts.onState?.("encoding");
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  const pollMs = opts.pollMs ?? 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    let job: { status: string; master_url?: string; reason?: string };
    try {
      const r = await doFetch(`${base}/jobs/${jobId}`);
      if (!r.ok) continue;
      job = (await r.json()) as typeof job;
    } catch {
      continue;
    }
    if (job.status === "ready" && job.master_url) return { url: job.master_url, jobId };
    if (job.status === "failed") throw new Error(`encode failed: ${job.reason ?? "unknown reason"}`);
  }
  throw new Error("encode timed out");
}

// The media-server upload id embedded in an encoded master URL (http://host/media/<id>/master.m3u8), or null
// for a pasted/placeholder URL that has no bytes on our ingest server to delete.
export function mediaIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/media\/([^/]+)\//);
  return m ? decodeURIComponent(m[1]) : null;
}

// Delete the encoded files for an uploaded master on the local media server. Idempotent and best-effort: a
// pasted/placeholder URL (no upload id) is a no-op, and a network error is swallowed so pruning the variant
// row still succeeds. Returns true only when the server confirmed a delete.
export async function deleteMedia(
  url: string | undefined,
  opts: { baseUrl?: string; fetch?: typeof globalThis.fetch } = {},
): Promise<boolean> {
  const id = mediaIdFromUrl(url);
  if (!id) return false;
  const base = (opts.baseUrl ?? mediaBaseUrl()).replace(/\/$/, "");
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  try {
    const res = await doFetch(`${base}/media/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => ({}))) as { deleted?: boolean };
    return body.deleted === true;
  } catch {
    return false;
  }
}

// Liveness check for the local media server, so the panel can show whether uploads will work BEFORE the
// author tries. Returns false on any error (server down, CORS, timeout).
export async function pingMediaServer(opts: { baseUrl?: string; fetch?: typeof globalThis.fetch } = {}): Promise<boolean> {
  const base = (opts.baseUrl ?? mediaBaseUrl()).replace(/\/$/, "");
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  try {
    const res = await doFetch(`${base}/healthz`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

// True when a playback_url points at a directly playable video (an uploaded master on the media server,
// or a plain video file), as opposed to an HLS playlist or a cdn.example placeholder. Used to decide when
// to show a real preview rather than the gradient.
export function isPlayableVideoUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (/\.(m3u8|mp4|m4v|mov|webm|ogv|ogg)(\?|$)/i.test(url)) return true;
  if (url.includes("/media/")) return true;
  return false;
}

// Attach a source to a <video>, using hls.js for HLS (.m3u8) where the browser cannot play it natively
// (everywhere except Safari). Returns a cleanup function. Dynamically imports hls.js so it is only loaded
// when an HLS source is actually played. No em dashes.
export async function attachHls(video: HTMLVideoElement, url: string): Promise<() => void> {
  const isHls = /\.m3u8(\?|$)/i.test(url);
  if (!isHls || video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
    return () => {
      video.removeAttribute("src");
      video.load();
    };
  }
  const { default: Hls } = await import("hls.js");
  if (!Hls.isSupported()) {
    video.src = url;
    return () => {};
  }
  const hls = new Hls();
  hls.loadSource(url);
  hls.attachMedia(video);
  return () => hls.destroy();
}
