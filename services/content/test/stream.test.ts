// Unit spec for the Cloudflare Stream module: the tus creation request, webhook signature verification, and
// the self-signed RS256 playback token. No network. No em dashes.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, createVerify } from "node:crypto";
import { createStreamApi, verifyStreamSignature, streamConfigFromEnv } from "../src/stream.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pemB64 = Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }) as string).toString("base64");
const cfg = { accountId: "acct", apiToken: "tok", webhookSecret: "whs", signingKeyId: "kid1", signingKeyPemBase64: pemB64 };

test("createDirectUpload sends a tus creation request with signed-URL metadata and returns the one-time URL", async () => {
  let seen: { url: string; headers: Record<string, string> } | null = null;
  const fetchFn = (async (url: string, init: RequestInit) => {
    seen = { url, headers: init.headers as Record<string, string> };
    return new Response(null, { status: 201, headers: { location: "https://upload.example/tus/abc", "stream-media-id": "uid123" } });
  }) as unknown as typeof fetch;
  const api = createStreamApi(cfg, fetchFn);
  const up = await api.createDirectUpload({ sizeBytes: 1234, name: "ep1.mp4", creatorId: "user-1" });
  assert.deepEqual(up, { uid: "uid123", uploadUrl: "https://upload.example/tus/abc" });
  assert.equal(seen!.url, "https://api.cloudflare.com/client/v4/accounts/acct/stream?direct_user=true");
  assert.equal(seen!.headers["Tus-Resumable"], "1.0.0");
  assert.equal(seen!.headers["Upload-Length"], "1234");
  assert.equal(seen!.headers["Upload-Creator"], "user-1");
  assert.match(seen!.headers["Upload-Metadata"], /requiresignedurls/);
  assert.match(seen!.headers["Upload-Metadata"], new RegExp(`name ${Buffer.from("ep1.mp4").toString("base64")}`));
});

test("createDirectUpload fails loudly when Stream refuses", async () => {
  const api = createStreamApi(cfg, (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch);
  await assert.rejects(api.createDirectUpload({ sizeBytes: 1, name: "x", creatorId: "u" }), /403/);
});

test("webhook signature: valid accepted; wrong secret, tampered body, stale time, malformed header refused", () => {
  const now = 1_800_000_000;
  const body = JSON.stringify({ uid: "u1", readyToStream: true });
  const sig = (b: string, secret = "whs", t = now) => `time=${t},sig1=${createHmac("sha256", secret).update(`${t}.${b}`).digest("hex")}`;
  assert.equal(verifyStreamSignature(body, sig(body), "whs", now), true);
  assert.equal(verifyStreamSignature(body, sig(body, "other"), "whs", now), false);
  assert.equal(verifyStreamSignature(body.replace("u1", "u2"), sig(body), "whs", now), false);
  assert.equal(verifyStreamSignature(body, sig(body, "whs", now - 3600), "whs", now), false);
  assert.equal(verifyStreamSignature(body, "garbage", "whs", now), false);
  assert.equal(verifyStreamSignature(body, undefined, "whs", now), false);
});

test("signPlaybackUrl swaps the uid for an RS256 token that verifies with the key and expires", () => {
  const api = createStreamApi(cfg);
  const hls = "https://customer-abc.cloudflarestream.com/uid123/manifest/video.m3u8";
  const url = api.signPlaybackUrl(hls, "uid123", 600);
  const token = url.split("/")[3];
  assert.ok(url.startsWith("https://customer-abc.cloudflarestream.com/") && url.endsWith("/manifest/video.m3u8"));
  const [h, p, sgn] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "RS256", kid: "kid1" });
  const claims = JSON.parse(Buffer.from(p, "base64url").toString()) as { sub: string; kid: string; exp: number };
  assert.equal(claims.sub, "uid123");
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 601);
  assert.equal(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(sgn, "base64url")), true);
});

test("streamConfigFromEnv is all-or-nothing", () => {
  assert.equal(streamConfigFromEnv({ CLOUDFLARE_ACCOUNT_ID: "a" }), null);
  assert.ok(
    streamConfigFromEnv({
      CLOUDFLARE_ACCOUNT_ID: "a",
      CLOUDFLARE_STREAM_API_TOKEN: "t",
      STREAM_WEBHOOK_SECRET: "w",
      STREAM_SIGNING_KEY_ID: "k",
      STREAM_SIGNING_KEY_PEM: "p",
    }),
  );
});
