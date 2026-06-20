// LARGE-FILE OVERFLOW upload path. Masters above the Supabase per-file ceiling route here and land in the
// Cloudflare R2 bucket via the dedicated `axessplayer-r2-upload` edge function (init -> chunk -> complete).
// The browser streams each part's bytes to the function, which PUTs them to R2 server-side (chunk-proxy), so
// no browser-side R2 CORS policy is needed and the R2 credentials never reach the client. Every object is
// forced under the axessplayer/ key prefix by the function. Pairs with storageUpload.ts (the Supabase TUS
// path); uploadRouter.ts picks between them by file size. No em dashes.

import { storageConfig, StorageUploadError, type UploadOptions, type UploadResult } from "./storageUpload.js";

// R2 multipart parts must be >= 5MB (except the last). 64MB keeps the part count low: a 100GB master is
// ~1600 parts, well under R2's 10000-part cap, and each part is a manageable proxy request.
const R2_PART_SIZE = 64 * 1024 * 1024;

const FN_NAME = "axessplayer-r2-upload";

interface InitResponse {
  uploadId: string;
  key: string;
}
interface ChunkResponse {
  partNumber: number;
  etag: string;
}
interface CompleteResponse {
  success: boolean;
  key: string;
  publicUrl: string | null;
}

async function readErr(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `http_${res.status}`;
  } catch {
    return `http_${res.status}`;
  }
}

// Upload one large master to R2 via the edge function and return its public URL. Throws StorageUploadError
// with an actionable message on any failure. Progress is reported per completed part.
export async function uploadMasterR2(
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
  const fn = `${cfg.url}/functions/v1/${FN_NAME}`;
  const authHeaders = { authorization: `Bearer ${cfg.anonKey}`, apikey: cfg.anonKey };

  // 1) init the multipart upload.
  const initRes = await fetch(`${fn}?action=init`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ seriesId, fileName: file.name, fileType: file.type || "video/mp4" }),
  });
  if (!initRes.ok) throw new StorageUploadError(`Upload to R2 failed (init): ${await readErr(initRes)}`);
  const { uploadId, key } = (await initRes.json()) as InitResponse;

  // 2) stream each part's bytes through the function to R2.
  const total = file.size;
  const partCount = Math.max(1, Math.ceil(total / R2_PART_SIZE));
  const parts: Array<{ partNumber: number; etag: string }> = [];
  let uploaded = 0;
  for (let i = 0; i < partCount; i++) {
    const start = i * R2_PART_SIZE;
    const end = Math.min(start + R2_PART_SIZE, total);
    const blob = file.slice(start, end);
    const q = `key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${i + 1}`;
    const res = await fetch(`${fn}?action=chunk&${q}`, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/octet-stream" },
      body: blob,
    });
    if (!res.ok) throw new StorageUploadError(`Upload to R2 failed on part ${i + 1}: ${await readErr(res)}`);
    const { etag } = (await res.json()) as ChunkResponse;
    if (!etag) throw new StorageUploadError(`Upload to R2 failed: part ${i + 1} returned no ETag.`);
    parts.push({ partNumber: i + 1, etag });
    uploaded += end - start;
    opts.onProgress?.(total > 0 ? uploaded / total : 1);
  }

  // 3) complete the multipart upload.
  const compRes = await fetch(`${fn}?action=complete`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ key, uploadId, parts }),
  });
  if (!compRes.ok) throw new StorageUploadError(`Upload to R2 failed (complete): ${await readErr(compRes)}`);
  const { publicUrl } = (await compRes.json()) as CompleteResponse;
  if (!publicUrl) {
    // The bytes are safely in R2, but with no public R2 domain bound the file cannot be served to the
    // player or read by the produce pipeline. Surface this rather than registering an unreadable URL.
    throw new StorageUploadError(
      "Uploaded to R2 but no public R2 domain is configured (set CLOUDFLARE_R2_PUBLIC_URL). The master is stored; bind an R2 public/custom domain so it can be served and processed.",
    );
  }
  return { publicUrl, path: key };
}
