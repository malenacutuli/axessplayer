// SLICE B - REAL uploads for the Studio. A dropped 9:16 master is uploaded DIRECTLY from the browser to the
// PUBLIC Supabase storage "videos" bucket, then its public URL is registered as a beat_variant playback_url
// through the existing content POST /variants endpoint. This replaces the old loop that streamed to a local
// media-server (tools/media-server) which is not deployed.
//
// LARGE FILES: uploads use the Supabase RESUMABLE (TUS) endpoint, not a single POST. A single POST of a
// multi-GB master is unreliable (the connection resets and the browser reports "Failed to fetch"); TUS
// chunks the file (6MB chunks, the size Supabase requires), retries on network blips, and resumes a partial
// upload, so masters up to the bucket limit move reliably with real progress.
//
// AUTH: the browser uses VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (public, same as apps/web). No
// service-role key ever reaches the browser. Writes are gated by the storage RLS policy that allows the QA
// studio (anon) to write ONLY under the videos/axessplayer/** prefix, so the shared Axessible bucket keeps
// its own user-scoped policies for every other path. That is why every master path begins with "axessplayer/".
// When the project is not configured (missing env), the panel shows a graceful "storage not configured"
// state rather than crashing. No em dashes.

import * as tus from "tus-js-client";

export const VIDEOS_BUCKET = "videos";
// Every studio master lives under this prefix; the storage RLS policy scopes anon writes to it.
export const MASTERS_PREFIX = "axessplayer";
// Supabase resumable uploads require exactly 6MB chunks.
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

export interface StorageConfig {
  url: string;
  anonKey: string;
}

type EnvBag = Record<string, string | undefined>;

function readEnv(): EnvBag {
  // import.meta.env carries the VITE_ vars under Vite/Vitest; guard for any bare runtime.
  try {
    return (import.meta as unknown as { env?: EnvBag }).env ?? {};
  } catch {
    return {};
  }
}

// The public browser config for direct-to-storage uploads. Null (a normal, handled state) when either env
// value is missing, so the panel renders "storage not configured" rather than throwing.
export function storageConfig(env: EnvBag = readEnv()): StorageConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url: url.replace(/\/$/, ""), anonKey };
}

// A tiny RFC4122-ish v4 id. crypto.randomUUID exists in every modern browser and in jsdom; the fallback
// keeps the bundle dependency-free if it is ever absent.
function uuid(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// The storage object path for a master: axessplayer/<seriesId>/<uuid>.<ext>. The leading prefix is what the
// RLS policy authorizes the anon studio to write. The extension is preserved from the dropped file
// (mp4/mov/webm/m4v), defaulting to mp4. seriesId is segment-sanitized so it is a safe path segment.
export function masterStoragePath(seriesId: string, fileName: string): string {
  const ext = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? "mp4").toLowerCase();
  const safeSeries = (seriesId || "unsorted").replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${MASTERS_PREFIX}/${safeSeries}/${uuid()}.${ext}`;
}

export interface UploadResult {
  // The PUBLIC storage URL of the uploaded master, used as the beat_variant playback_url.
  publicUrl: string;
  // The object path within the videos bucket (axessplayer/seriesId/<uuid>.ext).
  path: string;
}

export class StorageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageUploadError";
  }
}

export interface UploadOptions {
  // Progress in [0,1], called as chunks complete. Lets the panel show a real upload bar for big masters.
  onProgress?: (fraction: number) => void;
  // Test seam: inject the storage config so unit tests need no real project env.
  config?: StorageConfig | null;
}

// Upload one master DIRECTLY to the public videos bucket via the resumable (TUS) endpoint and return its
// public URL. Throws a StorageUploadError with an actionable message on any failure (unconfigured, network,
// RLS denial). The browser does the bytes in 6MB chunks; nothing transits our servers. contentType is
// preserved so the object is served playable.
export async function uploadMaster(
  file: File,
  seriesId: string,
  opts: UploadOptions = {},
): Promise<UploadResult> {
  const cfg = opts.config !== undefined ? opts.config : storageConfig();
  if (!cfg) {
    throw new StorageUploadError(
      "Storage is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for this build.",
    );
  }
  const path = masterStoragePath(seriesId, file.name);

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${cfg.url}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${cfg.anonKey}`,
        apikey: cfg.anonKey,
        "x-upsert": "false",
      },
      // Supabase needs the bytes streamed during creation, a fixed 6MB chunk, and the bucket + object name +
      // content type in metadata. removeFingerprintOnSuccess keeps localStorage clean across re-uploads.
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: TUS_CHUNK_SIZE,
      metadata: {
        bucketName: VIDEOS_BUCKET,
        objectName: path,
        contentType: file.type || "video/mp4",
        cacheControl: "3600",
      },
      onError: (e: unknown) =>
        reject(
          new StorageUploadError(
            `Upload to storage failed: ${e instanceof Error ? e.message : String(e)}`,
          ),
        ),
      onProgress: (sent: number, total: number) =>
        opts.onProgress?.(total > 0 ? sent / total : 0),
      onSuccess: () => resolve(),
    });
    // Resume an interrupted upload of the same file if one is on record, else start fresh.
    upload
      .findPreviousUploads()
      .then((prev) => {
        if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0]);
        upload.start();
      })
      .catch(() => upload.start());
  });

  // Public bucket: the object is served at the public path without a signed URL.
  const publicUrl = `${cfg.url}/storage/v1/object/public/${VIDEOS_BUCKET}/${path}`;
  return { publicUrl, path };
}

// Liveness/configuration check so the panel can tell the creator BEFORE they drop a file whether uploads
// will work. True only when the public storage config is present.
export function isStorageConfigured(): boolean {
  return storageConfig() != null;
}
