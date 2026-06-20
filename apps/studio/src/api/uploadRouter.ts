// Picks the upload backend by file size. Masters at or below the Supabase per-file ceiling go through the
// Supabase resumable (TUS) path (storageUpload.ts); larger masters route to Cloudflare R2 (r2Upload.ts) as
// the overflow backend. The threshold is configurable via VITE_R2_THRESHOLD_BYTES so it can track the
// project's actual Supabase limit. Both paths return the same UploadResult shape. No em dashes.

import { uploadMaster, type UploadOptions, type UploadResult } from "./storageUpload.js";
import { uploadMasterR2 } from "./r2Upload.js";
import { uploadMasterFast } from "./r2FastUpload.js";

export type UploadBackend = "supabase" | "r2";

export interface RoutedUploadResult extends UploadResult {
  backend: UploadBackend;
}

type EnvBag = Record<string, string | undefined>;

function readEnv(): EnvBag {
  try {
    return (import.meta as unknown as { env?: EnvBag }).env ?? {};
  } catch {
    return {};
  }
}

// Default 50GB. Supabase's resumable per-file ceiling is ~50GB; anything larger must use R2. Override with
// VITE_R2_THRESHOLD_BYTES to match the project's configured limit exactly.
export const DEFAULT_R2_THRESHOLD_BYTES = 50 * 1024 * 1024 * 1024;

export function r2ThresholdBytes(env: EnvBag = readEnv()): number {
  const v = Number(env.VITE_R2_THRESHOLD_BYTES);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_R2_THRESHOLD_BYTES;
}

// Files strictly larger than the threshold go to R2; everything else to Supabase.
export function chooseBackend(sizeBytes: number, threshold: number = r2ThresholdBytes()): UploadBackend {
  return sizeBytes > threshold ? "r2" : "supabase";
}

// Upload a master. The DEFAULT is the FAST path: presigned multipart directly to R2 with parts in parallel
// (2-4x faster than sequential Supabase TUS chunks). If that fails (CORS, transient, or a build without R2),
// it falls back to the Supabase resumable path so an upload still succeeds. Very large files (> threshold)
// keep the proven R2 multipart path explicitly.
export async function uploadMasterRouted(
  file: File,
  seriesId: string,
  opts: UploadOptions = {},
): Promise<RoutedUploadResult> {
  try {
    const result = await uploadMasterFast(file, seriesId, opts);
    return { ...result, backend: "r2" };
  } catch {
    // Fast path failed: fall back to the reliable Supabase resumable upload (or R2 overflow for huge files).
    if (chooseBackend(file.size) === "r2") {
      const result = await uploadMasterR2(file, seriesId, opts);
      return { ...result, backend: "r2" };
    }
    const result = await uploadMaster(file, seriesId, opts);
    return { ...result, backend: "supabase" };
  }
}
