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

export async function uploadMaster(
  file: File,
  opts: { baseUrl?: string; fetch?: typeof globalThis.fetch } = {},
): Promise<UploadedMaster> {
  const base = (opts.baseUrl ?? mediaBaseUrl()).replace(/\/$/, "");
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const res = await doFetch(`${base}/upload/${encodeURIComponent(file.name)}`, {
    method: "PUT",
    headers: file.type ? { "content-type": file.type } : undefined,
    body: file,
  });
  if (!res.ok) throw new Error(`upload_failed_${res.status}`);
  return (await res.json()) as UploadedMaster;
}

// True when a playback_url points at a directly playable video (an uploaded master on the media server,
// or a plain video file), as opposed to an HLS playlist or a cdn.example placeholder. Used to decide when
// to show a real preview rather than the gradient.
export function isPlayableVideoUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (/\.(mp4|m4v|mov|webm|ogv|ogg)(\?|$)/i.test(url)) return true;
  if (url.includes("/media/")) return true;
  return false;
}
