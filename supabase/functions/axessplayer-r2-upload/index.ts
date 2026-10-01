// AXESSPLAYER R2 OVERFLOW UPLOAD (additive; does NOT touch Axessible's own R2 functions). Backs the Studio
// large-file path: masters above the Supabase per-file ceiling route here and land in a DEDICATED public R2
// bucket (axessplayer-masters), isolated from Axessible's shared axessvideo-uploads bucket. Unlike the
// existing generate/get/complete-r2 functions, this does NOT require a Supabase auth user (the Studio is
// QA-grade anon, session-token auth). Instead every object is FORCED under the 'axessplayer/' key prefix.
// The anon JWT signature is still checked by the platform (verify_jwt=true).
//
// Model: CHUNK-PROXY. The browser streams each part's bytes to this function (?action=chunk) and the
// function PUTs them to R2 server-side. This avoids needing a browser-side CORS policy on the R2 bucket;
// the R2 credentials never leave the server. Actions: init -> chunk (per part) -> complete.
//
// Reads CLOUDFLARE_R2_ENDPOINT / _ACCESS_KEY_ID / _SECRET_ACCESS_KEY (account-level, already configured).
// Targets the dedicated bucket (CLOUDFLARE_R2_AXESSPLAYER_BUCKET, default axessplayer-masters) and serves
// via its managed public r2.dev domain (CLOUDFLARE_R2_PUBLIC_URL, default the bound pub-*.r2.dev domain),
// so complete returns a publicly readable playback URL for the player + produce pipeline. No em dashes.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const PREFIX = "axessplayer";
const DEFAULT_BUCKET = "axessplayer-masters";
const DEFAULT_PUBLIC_BASE = "https://pub-3b4a04d7ab8f47b384a62d22a42a2c43.r2.dev";

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

async function sign(method: string, url: string, accessKeyId: string, secretAccessKey: string, payloadHash: string) {
  const encoder = new TextEncoder();
  const dateTime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = dateTime.substring(0, 8);
  const region = "auto";
  const service = "s3";
  const urlObj = new URL(url);
  const rawPath = url.substring(url.indexOf("/", url.indexOf("://") + 3)).split("?")[0];
  const canonicalRequest = [
    method,
    rawPath,
    urlObj.search.substring(1),
    `host:${urlObj.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${dateTime}`,
    "",
    "host;x-amz-content-sha256;x-amz-date",
    payloadHash,
  ].join("\n");
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${dateTime}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;
  async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
    const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data)));
  }
  let key = encoder.encode("AWS4" + secretAccessKey);
  key = await hmac(key, date);
  key = await hmac(key, region);
  key = await hmac(key, service);
  key = await hmac(key, "aws4_request");
  const signature = hex(await hmac(key, stringToSign).then((u) => u.buffer));
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
    "x-amz-date": dateTime,
    "x-amz-content-sha256": payloadHash,
  };
}

function r2Env() {
  const endpoint = (Deno.env.get("CLOUDFLARE_R2_ENDPOINT") ?? "").replace(/\/$/, "");
  const accessKeyId = Deno.env.get("CLOUDFLARE_R2_ACCESS_KEY_ID") ?? "";
  const secretAccessKey = Deno.env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY") ?? "";
  const bucket = Deno.env.get("CLOUDFLARE_R2_AXESSPLAYER_BUCKET") ?? DEFAULT_BUCKET;
  const publicBase = (Deno.env.get("CLOUDFLARE_R2_PUBLIC_URL") ?? DEFAULT_PUBLIC_BASE).replace(/\/$/, "");
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) throw new Error("R2 is not configured");
  return { endpoint, accessKeyId, secretAccessKey, bucket, publicBase };
}

function objectUrl(endpoint: string, bucket: string, key: string, query: string): string {
  const parts = key.split("/");
  const file = encodeURIComponent(parts.pop()!);
  const path = parts.join("/");
  return `${endpoint}/${bucket}/${path}/${file}?${query}`;
}

function sanitizeSegment(s: string): string {
  return (s || "unsorted").replace(/[^a-zA-Z0-9_.-]/g, "-");
}
function assertPrefixed(key: string) {
  if (!key.startsWith(`${PREFIX}/`)) throw new Error("key must be under the axessplayer/ prefix");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const caller = await requireUser(req, corsHeaders);
  if (caller instanceof Response) return caller;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const env = r2Env();
    const action = new URL(req.url).searchParams.get("action");

    if (action === "init") {
      const { seriesId, fileName, fileType } = await req.json();
      const ext = (String(fileName).match(/\.([a-z0-9]+)$/i)?.[1] ?? "mp4").toLowerCase();
      const key = `${PREFIX}/${sanitizeSegment(String(seriesId))}/${crypto.randomUUID()}/master.${ext}`;
      const url = objectUrl(env.endpoint, env.bucket, key, "uploads=");
      const auth = await sign("POST", url, env.accessKeyId, env.secretAccessKey, await sha256Hex(""));
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: auth.authorization, "x-amz-date": auth["x-amz-date"], "x-amz-content-sha256": auth["x-amz-content-sha256"], "Content-Type": String(fileType || "video/mp4") },
      });
      if (!res.ok) return json(502, { error: `r2_init_failed: ${res.status} ${(await res.text()).slice(0, 200)}` });
      const xml = await res.text();
      const uploadId = xml.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
      if (!uploadId) return json(502, { error: "r2_init_no_upload_id" });
      return json(200, { uploadId, key });
    }

    if (action === "chunk") {
      const q = new URL(req.url).searchParams;
      const key = q.get("key") ?? "";
      const uploadId = q.get("uploadId") ?? "";
      const partNumber = Number(q.get("partNumber") ?? "0");
      assertPrefixed(key);
      if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1) return json(400, { error: "bad_chunk_params" });
      const body = new Uint8Array(await req.arrayBuffer());
      const url = objectUrl(env.endpoint, env.bucket, key, `partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`);
      const auth = await sign("PUT", url, env.accessKeyId, env.secretAccessKey, "UNSIGNED-PAYLOAD");
      const res = await fetch(url, {
        method: "PUT",
        headers: { Authorization: auth.authorization, "x-amz-date": auth["x-amz-date"], "x-amz-content-sha256": "UNSIGNED-PAYLOAD" },
        body,
      });
      if (!res.ok) return json(502, { error: `r2_chunk_failed: ${res.status} ${(await res.text()).slice(0, 200)}` });
      const etag = (res.headers.get("ETag") ?? "").replace(/"/g, "");
      return json(200, { partNumber, etag });
    }

    if (action === "complete") {
      const { key, uploadId, parts } = await req.json();
      assertPrefixed(String(key));
      if (!uploadId || !Array.isArray(parts) || parts.length === 0) return json(400, { error: "bad_complete_params" });
      const partsXml = parts
        .map((p: { partNumber: number; etag: string }) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`)
        .join("");
      const completeBody = `<CompleteMultipartUpload>${partsXml}</CompleteMultipartUpload>`;
      const url = objectUrl(env.endpoint, env.bucket, String(key), `uploadId=${encodeURIComponent(uploadId)}`);
      const auth = await sign("POST", url, env.accessKeyId, env.secretAccessKey, await sha256Hex(completeBody));
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: auth.authorization, "x-amz-date": auth["x-amz-date"], "x-amz-content-sha256": auth["x-amz-content-sha256"], "Content-Type": "application/xml" },
        body: completeBody,
      });
      if (!res.ok) return json(502, { error: `r2_complete_failed: ${res.status} ${(await res.text()).slice(0, 200)}` });
      const publicUrl = env.publicBase ? `${env.publicBase}/${key}` : null;
      return json(200, { success: true, key, publicUrl });
    }

    return json(400, { error: "unknown_action (use ?action=init|chunk|complete)" });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
