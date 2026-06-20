// FAST master upload: presigned multipart DIRECTLY to R2, parts in PARALLEL. This is the 2-4x speedup over
// sequential 6MB Supabase TUS chunks: init -> presign all parts -> the browser PUTs parts concurrently
// straight to R2 (CORS-enabled, ETag exposed) -> complete. Returns the durable public R2 URL. Falls back to
// the Supabase TUS path (uploadRouter) on any failure. No em dashes.

import { storageConfig, StorageUploadError, type UploadOptions, type UploadResult } from "./storageUpload.js";

const FN = "axessplayer-r2-presign";
// 32MB parts: above R2's 5MB minimum, few enough requests, big enough to use bandwidth; <=10000 parts covers
// any realistic master. The browser caps ~6 connections per host, so 6 parts upload at once.
const PART_SIZE = 32 * 1024 * 1024;
const CONCURRENCY = 6;

interface InitResp {
  key: string;
  uploadId: string;
  publicUrl: string;
}

export async function uploadMasterFast(file: File, seriesId: string, opts: UploadOptions = {}): Promise<UploadResult> {
  const cfg = opts.config !== undefined ? opts.config : storageConfig();
  if (!cfg) throw new StorageUploadError("Storage is not configured (set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).");
  const fn = `${cfg.url}/functions/v1/${FN}`;
  const authHeaders = { authorization: `Bearer ${cfg.anonKey}`, apikey: cfg.anonKey, "content-type": "application/json" };
  const call = async (body: unknown): Promise<Record<string, unknown>> => {
    const res = await fetch(fn, { method: "POST", headers: authHeaders, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new StorageUploadError(`R2 presign ${(body as { action?: string }).action}: ${String(json.error ?? res.status)}`);
    return json;
  };

  // 1) init + 2) presign all parts.
  const init = (await call({ action: "init", seriesId, fileName: file.name, fileType: file.type || "video/mp4" })) as unknown as InitResp;
  const partCount = Math.max(1, Math.ceil(file.size / PART_SIZE));
  const signed = await call({ action: "sign", key: init.key, uploadId: init.uploadId, parts: partCount });
  const urls = signed.urls as string[];
  if (!Array.isArray(urls) || urls.length !== partCount) throw new StorageUploadError("R2 presign returned the wrong number of part urls.");

  // 3) PUT parts directly to R2, CONCURRENCY at a time.
  const parts: Array<{ partNumber: number; etag: string }> = new Array(partCount);
  let uploaded = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < partCount) {
      const i = next++;
      const start = i * PART_SIZE;
      const end = Math.min(start + PART_SIZE, file.size);
      const blob = file.slice(start, end);
      const res = await fetch(urls[i], { method: "PUT", body: blob });
      if (!res.ok) throw new StorageUploadError(`R2 part ${i + 1} upload failed: ${res.status}`);
      const etag = (res.headers.get("ETag") ?? res.headers.get("etag") ?? "").replace(/"/g, "");
      if (!etag) throw new StorageUploadError(`R2 part ${i + 1} returned no ETag (check bucket CORS exposes ETag).`);
      parts[i] = { partNumber: i + 1, etag };
      uploaded += end - start;
      opts.onProgress?.(file.size > 0 ? uploaded / file.size : 1);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, partCount) }, () => worker()));

  // 4) complete.
  const done = await call({ action: "complete", key: init.key, uploadId: init.uploadId, parts });
  return { publicUrl: (done.publicUrl as string) ?? init.publicUrl, path: init.key };
}
