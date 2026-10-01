// AXESSPLAYER fast master upload: presigned multipart to R2 (axessplayer-masters, public + CORS). The browser
// PUTs parts DIRECTLY to R2 in PARALLEL (no edge hop), which is the 2-4x speedup over sequential 6MB Supabase
// TUS chunks. Anon-callable; every key is forced under axessplayer/ so anon can only write our namespace.
// actions: init (create multipart) -> sign (presigned PUT url per part) -> complete. No em dashes.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const PREFIX = "axessplayer";
const BUCKET = "axessplayer-masters";
const REGION = "auto";
const SERVICE = "s3";

function hex(b: ArrayBuffer): string { return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join(""); }
async function sha256(s: string): Promise<string> { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); }
async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
}
async function signingKey(secret: string, date: string): Promise<Uint8Array> {
  let k = new TextEncoder().encode("AWS4" + secret);
  for (const d of [date, REGION, SERVICE, "aws4_request"]) k = await hmac(k, d);
  return k;
}
function stamp(): { dateTime: string; date: string } {
  const dateTime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { dateTime, date: dateTime.slice(0, 8) };
}
function rawPath(endpoint: string, key: string): string {
  // path-style: /<bucket>/<key>, only the segments encoded (slashes preserved)
  const host = new URL(endpoint).host;
  void host;
  const enc = key.split("/").map(encodeURIComponent).join("/");
  return `/${BUCKET}/${enc}`;
}

// Header-signed request (init / complete): signs host;x-amz-content-sha256;x-amz-date.
async function headerSigned(method: string, endpoint: string, key: string, query: string, payload: string, ak: string, sk: string) {
  const { dateTime, date } = stamp();
  const host = new URL(endpoint).host;
  const payloadHash = await sha256(payload);
  const path = rawPath(endpoint, key);
  const canonical = [method, path, query, `host:${host}`, `x-amz-content-sha256:${payloadHash}`, `x-amz-date:${dateTime}`, "", "host;x-amz-content-sha256;x-amz-date", payloadHash].join("\n");
  const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;
  const sts = `AWS4-HMAC-SHA256\n${dateTime}\n${scope}\n${await sha256(canonical)}`;
  const sig = hex((await hmac(await signingKey(sk, date), sts)).buffer);
  return {
    url: `${endpoint}${path}?${query}`,
    headers: { Authorization: `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${sig}`, "x-amz-date": dateTime, "x-amz-content-sha256": payloadHash },
  };
}

// Query-presigned PUT url for a part (browser uploads directly, UNSIGNED-PAYLOAD).
async function presignPart(endpoint: string, key: string, uploadId: string, partNumber: number, ak: string, sk: string, expires = 3600): Promise<string> {
  const { dateTime, date } = stamp();
  const host = new URL(endpoint).host;
  const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;
  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${ak}/${scope}`,
    "X-Amz-Date": dateTime,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
    partNumber: String(partNumber),
    uploadId,
  };
  const canonicalQuery = Object.keys(params).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join("&");
  const path = rawPath(endpoint, key);
  const canonical = ["PUT", path, canonicalQuery, `host:${host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const sts = `AWS4-HMAC-SHA256\n${dateTime}\n${scope}\n${await sha256(canonical)}`;
  const sig = hex((await hmac(await signingKey(sk, date), sts)).buffer);
  return `${endpoint}${path}?${canonicalQuery}&X-Amz-Signature=${sig}`;
}

function sanitize(s: string): string { return (s || "x").replace(/[^a-zA-Z0-9_.-]/g, "-"); }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const endpoint = (Deno.env.get("CLOUDFLARE_R2_ENDPOINT") ?? "").replace(/\/$/, "");
    const ak = Deno.env.get("CLOUDFLARE_R2_ACCESS_KEY_ID") ?? "";
    const sk = Deno.env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY") ?? "";
    const publicBase = (Deno.env.get("CLOUDFLARE_R2_PUBLIC_URL") ?? "https://pub-3b4a04d7ab8f47b384a62d22a42a2c43.r2.dev").replace(/\/$/, "");
    if (!endpoint || !ak || !sk) return json(400, { error: "R2 not configured" });
    const body = (await req.json()) as Record<string, unknown>;
    const action = body.action;

    if (action === "init") {
      const ext = (String(body.fileName ?? "").match(/\.([a-z0-9]+)$/i)?.[1] ?? "mp4").toLowerCase();
      const key = `${PREFIX}/masters/${sanitize(String(body.seriesId ?? "x"))}/${crypto.randomUUID()}.${ext}`;
      const s = await headerSigned("POST", endpoint, key, "uploads=", "", ak, sk);
      const res = await fetch(s.url, { method: "POST", headers: { ...s.headers, "Content-Type": String(body.fileType ?? "video/mp4") } });
      if (!res.ok) return json(502, { error: `r2_init_failed: ${res.status} ${(await res.text()).slice(0, 200)}` });
      const xml = await res.text();
      const uploadId = xml.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
      if (!uploadId) return json(502, { error: "no_upload_id" });
      return json(200, { key, uploadId, publicUrl: `${publicBase}/${key}` });
    }

    if (action === "sign") {
      const key = String(body.key ?? "");
      if (!key.startsWith(`${PREFIX}/`)) return json(400, { error: "key must be under axessplayer/" });
      const uploadId = String(body.uploadId ?? "");
      const parts = Math.max(1, Math.min(10000, Number(body.parts ?? 0)));
      if (!uploadId || !parts) return json(400, { error: "uploadId and parts required" });
      const urls: string[] = [];
      for (let i = 1; i <= parts; i++) urls.push(await presignPart(endpoint, key, uploadId, i, ak, sk));
      return json(200, { urls });
    }

    if (action === "complete") {
      const key = String(body.key ?? "");
      if (!key.startsWith(`${PREFIX}/`)) return json(400, { error: "key must be under axessplayer/" });
      const uploadId = String(body.uploadId ?? "");
      const parts = (body.parts ?? []) as Array<{ partNumber: number; etag: string }>;
      if (!uploadId || !Array.isArray(parts) || parts.length === 0) return json(400, { error: "bad complete params" });
      const xml = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
      const s = await headerSigned("POST", endpoint, key, `uploadId=${encodeURIComponent(uploadId)}`, xml, ak, sk);
      const res = await fetch(s.url, { method: "POST", headers: { ...s.headers, "Content-Type": "application/xml" }, body: xml });
      if (!res.ok) return json(502, { error: `r2_complete_failed: ${res.status} ${(await res.text()).slice(0, 200)}` });
      return json(200, { key, publicUrl: `${publicBase}/${key}` });
    }

    return json(400, { error: "invalid action (init|sign|complete)" });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
