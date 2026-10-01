// Cloudflare Stream integration for creator uploads (decision D2, 2026-10-01). Stream does the transcode
// (ABR HLS), storage, and delivery; this module only talks to its API:
//   - createDirectUpload: a one-time tus upload URL the creator's browser uploads to directly (no size cap;
//     the bytes never pass through our servers). Every video requires signed URLs.
//   - verifyWebhook: Stream's "Webhook-Signature: time=<unix>,sig1=<hex>" (HMAC-SHA256 of "<time>.<body>").
//   - signPlaybackUrl: a self-signed RS256 token (Stream signing key) swapped in for the uid in the HLS URL.
//   - copyFromUrl: import an existing video by URL (migrating media already in Supabase Storage).
// API reference: developers.cloudflare.com/stream (direct creator uploads, webhooks, securing your stream).
// No em dashes.

import { createHmac, createSign, timingSafeEqual } from "node:crypto";

export interface StreamConfig {
  accountId: string;
  apiToken: string;
  // From POST /accounts/{id}/stream/webhook (scripts/stream-setup.mjs).
  webhookSecret: string;
  // From POST /accounts/{id}/stream/keys: the key id and its base64-encoded PEM.
  signingKeyId: string;
  signingKeyPemBase64: string;
}

export function streamConfigFromEnv(env: NodeJS.ProcessEnv): StreamConfig | null {
  const c = {
    accountId: env.CLOUDFLARE_ACCOUNT_ID ?? "",
    apiToken: env.CLOUDFLARE_STREAM_API_TOKEN ?? "",
    webhookSecret: env.STREAM_WEBHOOK_SECRET ?? "",
    signingKeyId: env.STREAM_SIGNING_KEY_ID ?? "",
    signingKeyPemBase64: env.STREAM_SIGNING_KEY_PEM ?? "",
  };
  return Object.values(c).every((v) => v.length > 0) ? c : null;
}

export class StreamError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "StreamError";
  }
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export interface DirectUpload {
  uid: string;
  uploadUrl: string;
}

export interface StreamApi {
  createDirectUpload(input: { sizeBytes: number; name: string; creatorId: string; maxDurationSeconds?: number }): Promise<DirectUpload>;
  copyFromUrl(input: { url: string; name: string; creatorId?: string }): Promise<{ uid: string }>;
  signPlaybackUrl(hlsUrl: string, uid: string, ttlSeconds?: number): string;
  verifyWebhook(rawBody: string, header: string | undefined, nowSec?: number): boolean;
}

export const MAX_UPLOAD_BYTES = 30 * 1024 ** 3; // generous cap on a single master (30 GiB)
export const DEFAULT_MAX_DURATION_SECONDS = 4 * 60 * 60;
export const WEBHOOK_TOLERANCE_SEC = 300;
export const PLAYBACK_TTL_SECONDS = 6 * 60 * 60;

export function createStreamApi(cfg: StreamConfig, fetchFn: typeof fetch = fetch): StreamApi {
  const api = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/stream`;
  const pem = Buffer.from(cfg.signingKeyPemBase64, "base64").toString("utf8");

  return {
    async createDirectUpload({ sizeBytes, name, creatorId, maxDurationSeconds = DEFAULT_MAX_DURATION_SECONDS }) {
      // tus creation request (direct_user=true): the response Location is the one-time upload URL for the
      // browser, and stream-media-id is the video uid. The URL expires if unused.
      const expiry = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
      const metadata = [
        `name ${b64(name.slice(0, 200))}`,
        `maxDurationSeconds ${b64(String(maxDurationSeconds))}`,
        `expiry ${b64(expiry)}`,
        "requiresignedurls",
      ].join(",");
      const res = await fetchFn(`${api}?direct_user=true`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.apiToken}`,
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(sizeBytes),
          "Upload-Metadata": metadata,
          "Upload-Creator": creatorId,
        },
      });
      const uploadUrl = res.headers.get("location");
      const uid = res.headers.get("stream-media-id");
      if (res.status !== 201 || !uploadUrl || !uid) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        throw new StreamError(res.status, `stream direct upload failed (${res.status}) ${detail}`);
      }
      return { uid, uploadUrl };
    },

    async copyFromUrl({ url, name, creatorId }) {
      const res = await fetchFn(`${api}/copy`, {
        method: "POST",
        headers: { authorization: `Bearer ${cfg.apiToken}`, "content-type": "application/json" },
        body: JSON.stringify({ url, meta: { name }, requireSignedURLs: true, ...(creatorId ? { creator: creatorId } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; result?: { uid?: string } };
      if (!res.ok || !body.success || !body.result?.uid) throw new StreamError(res.status, `stream copy failed (${res.status})`);
      return { uid: body.result.uid };
    },

    signPlaybackUrl(hlsUrl, uid, ttlSeconds = PLAYBACK_TTL_SECONDS) {
      const now = Math.floor(Date.now() / 1000);
      const header = b64url(JSON.stringify({ alg: "RS256", kid: cfg.signingKeyId }));
      const payload = b64url(JSON.stringify({ sub: uid, kid: cfg.signingKeyId, nbf: now - 60, exp: now + ttlSeconds }));
      const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(pem).toString("base64url");
      const token = `${header}.${payload}.${signature}`;
      if (!hlsUrl.includes(uid)) throw new StreamError(500, "playback url does not contain the video uid");
      return hlsUrl.replace(uid, token);
    },

    verifyWebhook(rawBody, header, nowSec = Math.floor(Date.now() / 1000)) {
      return verifyStreamSignature(rawBody, header, cfg.webhookSecret, nowSec);
    },
  };
}

export function verifyStreamSignature(rawBody: string, header: string | undefined, secret: string, nowSec: number): boolean {
  if (!header || !secret) return false;
  let time: number | null = null;
  let sig: string | null = null;
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s.trim());
    if (k === "time" && v && /^\d+$/.test(v)) time = Number(v);
    else if (k === "sig1" && v) sig = v;
  }
  if (time === null || !sig || Math.abs(nowSec - time) > WEBHOOK_TOLERANCE_SEC) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${time}.${rawBody}`, "utf8").digest("hex"), "utf8");
  const got = Buffer.from(sig, "utf8");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// A Stream webhook body (the video object). Only the fields we use.
export interface StreamWebhookVideo {
  uid?: string;
  readyToStream?: boolean;
  status?: { state?: string; errReasonCode?: string };
  playback?: { hls?: string };
  duration?: number;
}

// The playback_url marker stored for a Stream variant until (and after) it is ready. The real, signed URL is
// produced at read time, so no long-lived playable URL is ever stored.
export const streamRef = (uid: string) => `stream:${uid}`;
export const isStreamRef = (url: string) => url.startsWith("stream:");
