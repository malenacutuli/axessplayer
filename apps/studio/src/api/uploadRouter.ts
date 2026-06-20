// Picks the upload backend by file size. Masters at or below the Supabase per-file ceiling go through the
// Supabase resumable (TUS) path (storageUpload.ts); larger masters route to Cloudflare R2 (r2Upload.ts) as
// the overflow backend. The threshold is configurable via VITE_R2_THRESHOLD_BYTES so it can track the
// project's actual Supabase limit. Both paths return the same UploadResult shape. No em dashes.

import { uploadMaster, type UploadOptions, type UploadResult } from "./storageUpload.js";
import { uploadMasterR2 } from "./r2Upload.js";

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

// Upload a master through whichever backend fits its size, returning the result plus which backend was used
// (so the panel can show "stored on R2" for overflow uploads).
export async function uploadMasterRouted(
  file: File,
  seriesId: string,
  opts: UploadOptions = {},
): Promise<RoutedUploadResult> {
  const backend = chooseBackend(file.size);
  const result =
    backend === "r2" ? await uploadMasterR2(file, seriesId, opts) : await uploadMaster(file, seriesId, opts);
  return { ...result, backend };
}
