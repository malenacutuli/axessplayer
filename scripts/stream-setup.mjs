#!/usr/bin/env node
// One-time Cloudflare Stream setup for the content service. Run it YOURSELF in your own terminal (not through
// an AI chat, so the secrets it creates never land in a transcript):
//
//   export CLOUDFLARE_ACCOUNT_ID=<account id>
//   export CLOUDFLARE_STREAM_API_TOKEN=<API token with Stream:Edit>
//   node scripts/stream-setup.mjs --webhook-url https://axessplayer-content.onrender.com/stream/webhook
//
// It (1) checks the token can use Stream on the account, (2) points Stream's webhook at the content service and
// receives the webhook signing secret, (3) creates a playback signing key. The values are written to a local
// file with owner-only permissions (default ./stream-secrets.env); only variable NAMES are printed. Copy the
// values into the Render content service's environment, then delete the file.
//
// Re-running creates another signing key (old ones keep working until deleted in the dashboard) and re-points
// the webhook. No em dashes.

import { writeFileSync, chmodSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const webhookUrl = arg("--webhook-url");
const outFile = arg("--out") ?? "stream-secrets.env";
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_STREAM_API_TOKEN;

if (!accountId || !token || !webhookUrl) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_STREAM_API_TOKEN, and pass --webhook-url <content>/stream/webhook");
  process.exit(2);
}

const api = `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`;
const call = async (method, path, body) => {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg = (json.errors ?? []).map((e) => `${e.code} ${e.message}`).join("; ") || `HTTP ${res.status}`;
    throw new Error(`${method} ${path || "/"} failed: ${msg}`);
  }
  return json.result;
};

try {
  await call("GET", "?limit=1");
  console.log("ok   Stream is enabled and the token can use it");

  const hook = await call("PUT", "/webhook", { notificationUrl: webhookUrl });
  if (!hook?.secret) throw new Error("webhook created but no secret returned");
  console.log(`ok   webhook -> ${webhookUrl}`);

  const key = await call("POST", "/keys");
  if (!key?.id || !key?.pem) throw new Error("signing key created but id/pem missing");
  console.log("ok   playback signing key created");

  const lines = [
    "# Cloudflare Stream settings for the Render content service. Copy into its environment, then delete this file.",
    `CLOUDFLARE_ACCOUNT_ID=${accountId}`,
    "# CLOUDFLARE_STREAM_API_TOKEN: the same token you exported to run this script",
    `STREAM_WEBHOOK_SECRET=${hook.secret}`,
    `STREAM_SIGNING_KEY_ID=${key.id}`,
    `STREAM_SIGNING_KEY_PEM=${key.pem}`,
    "",
  ];
  writeFileSync(outFile, lines.join("\n"), { mode: 0o600 });
  chmodSync(outFile, 0o600);
  console.log(`\nWrote ${outFile} (owner-only). Set these on the Render content service:`);
  console.log("  CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_STREAM_API_TOKEN, STREAM_WEBHOOK_SECRET, STREAM_SIGNING_KEY_ID, STREAM_SIGNING_KEY_PEM");
} catch (e) {
  console.error(`FAILED: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
