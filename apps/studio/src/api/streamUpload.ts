// Creator upload through Cloudflare Stream: ask the content service for a one-time tus URL (it creates the
// pending variant), then upload the file straight from the browser to Stream with tus (resumable). Stream
// transcodes to ABR HLS; its webhook marks the cut ready, so the variant stays "pending" until then.
// Chunks: 50 MiB (Stream requires >= 5 MiB and a multiple of 256 KiB). No em dashes.
import * as tus from "tus-js-client";
import type { ContentClient, StreamUploadRequest, StreamUploadStart } from "./client.js";

export const STREAM_CHUNK_BYTES = 50 * 1024 * 1024;

export interface StreamUploadOptions {
  onProgress?: (fraction: number) => void;
  // Injected in tests.
  uploadFile?: (file: File, uploadUrl: string, onProgress?: (fraction: number) => void) => Promise<void>;
}

export function tusUpload(file: File, uploadUrl: string, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      uploadUrl,
      chunkSize: STREAM_CHUNK_BYTES,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      onProgress: (sent, total) => onProgress?.(total > 0 ? sent / total : 0),
      onSuccess: () => resolve(),
      onError: (e) => reject(e instanceof Error ? e : new Error(String(e))),
    });
    upload.start();
  });
}

export async function uploadToStream(
  client: Pick<ContentClient, "startStreamUpload">,
  beatId: string,
  file: File,
  fields: Omit<StreamUploadRequest, "size_bytes" | "name"> = {},
  opts: StreamUploadOptions = {},
): Promise<StreamUploadStart> {
  const start = await client.startStreamUpload(beatId, { ...fields, size_bytes: file.size, name: file.name });
  await (opts.uploadFile ?? tusUpload)(file, start.upload_url, opts.onProgress);
  return start;
}
