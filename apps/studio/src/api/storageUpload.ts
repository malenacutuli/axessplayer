// SLICE B - REAL uploads for the Studio. A dropped 9:16 master is uploaded DIRECTLY from the browser to the
// PUBLIC Supabase storage "videos" bucket via the Supabase JS client, then its public URL is registered as a
// beat_variant playback_url through the existing content POST /variants endpoint. This replaces the old loop
// that streamed to a local media-server (tools/media-server) which is not deployed.
//
// The Supabase client here is configured from VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (the same public
// browser config apps/web uses). No service-role key ever reaches the browser: public-read + authenticated
// upload is enforced by the storage RLS policy in scripts/sql/16_storage_policies.sql. When the project is
// not configured (missing env), getStorageClient() returns null and the panel shows a graceful "storage not
// configured" state rather than crashing. No em dashes.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const VIDEOS_BUCKET = "videos";

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
  return { url, anonKey };
}

let cached: SupabaseClient | null | undefined;

// Singleton Supabase client for storage uploads, or null when unconfigured. Auth session is NOT persisted
// here: this client only signs storage requests with the public anon key (the RLS policy gates writes).
export function getStorageClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const cfg = storageConfig();
  cached = cfg ? createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } }) : null;
  return cached;
}

// Test seam: inject a client (or null) so panel tests run without a real Supabase project. Resets the
// memoized singleton.
export function __setStorageClientForTests(client: SupabaseClient | null): void {
  cached = client;
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

// The storage object path for a master: videos/<seriesId>/<uuid>.<ext>. The extension is preserved from the
// dropped file (mp4/mov/webm/m4v), defaulting to mp4. seriesId is segment-sanitized so it is a safe path.
export function masterStoragePath(seriesId: string, fileName: string): string {
  const ext = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? "mp4").toLowerCase();
  const safeSeries = (seriesId || "unsorted").replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${safeSeries}/${uuid()}.${ext}`;
}

export interface UploadResult {
  // The PUBLIC storage URL of the uploaded master, used as the beat_variant playback_url.
  publicUrl: string;
  // The object path within the videos bucket (seriesId/<uuid>.ext).
  path: string;
}

export class StorageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageUploadError";
  }
}

// Upload one master mp4 (9:16) DIRECTLY to the public videos bucket and return its public URL. Throws a
// StorageUploadError with an actionable message on any failure (unconfigured, network, RLS denial). The
// browser does the bytes; nothing transits our servers. contentType is preserved so the object is served
// playable.
export async function uploadMaster(
  file: File,
  seriesId: string,
  opts: { client?: SupabaseClient | null } = {},
): Promise<UploadResult> {
  const client = opts.client !== undefined ? opts.client : getStorageClient();
  if (!client) {
    throw new StorageUploadError(
      "Storage is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for this build.",
    );
  }
  const path = masterStoragePath(seriesId, file.name);
  const { error } = await client.storage.from(VIDEOS_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "video/mp4",
  });
  if (error) {
    throw new StorageUploadError(`Upload to storage failed: ${error.message}`);
  }
  const { data } = client.storage.from(VIDEOS_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new StorageUploadError("Upload succeeded but no public URL was returned.");
  }
  return { publicUrl: data.publicUrl, path };
}

// Liveness/configuration check so the panel can tell the creator BEFORE they drop a file whether uploads
// will work. True only when the public storage config is present.
export function isStorageConfigured(): boolean {
  return getStorageClient() != null;
}
