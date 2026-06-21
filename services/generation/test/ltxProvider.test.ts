// LTX-2.3 provider tests: the registry exposes ltx as the primary animated renderer, the router pins it via
// providerHint, and makeEdgeProviderClient maps submit/poll onto the axessplayer-ltx-video edge fn (text- vs
// image-to-video by anchor, the endpoint-carrying handle, status mapping, native-audio default). A fake fetch
// stands in for the edge function so no network or spend happens. No em dashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseModel, defaultRegistry, runModel, type GenerationBrief } from "../src/router.js";
import { makeEdgeProviderClient, type EdgeConfig } from "../src/providerClient.js";

const CFG: EdgeConfig = { supabaseUrl: "https://x.supabase.co", apiKey: "anon-key" };

// A scripted fetch that answers the ltx edge fn (start -> id+endpoint, status -> SUCCEEDED) and the re-host
// upload + download. Records the start request body so we can assert the mapping.
function fakeFetch(opts: { lastFrameUrl?: string | null; failStart?: boolean } = {}) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fn = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/functions/v1/axessplayer-ltx-video")) {
      // Only the edge-fn calls carry a JSON body; the re-host upload body is raw bytes (never parse that).
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ url: u, body });
      if (body.action === "start") {
        if (opts.failStart) return new Response(JSON.stringify({ error: "boom" }), { status: 502 });
        const endpoint = typeof body.imageUri === "string" && body.imageUri ? "image-to-video" : "text-to-video";
        return new Response(JSON.stringify({ id: "job-123", status: "PENDING", endpoint }), { status: 200 });
      }
      // status
      return new Response(
        JSON.stringify({ status: "SUCCEEDED", videoUrl: "https://storage.googleapis.com/ltx/out.mp4", lastFrameUrl: opts.lastFrameUrl ?? null }),
        { status: 200 },
      );
    }
    // re-host: download the ephemeral mp4, then upload to storage
    if (u.includes("storage.googleapis.com")) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    if (u.includes("/storage/v1/object/")) return new Response("{}", { status: 200 });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test("the registry exposes LTX-2.3 as a poll-based animated video provider with native audio", () => {
  const reg = defaultRegistry();
  const ltx = reg.filter((m) => m.provider === "ltx");
  assert.equal(ltx.length, 2, "ltx-fast + ltx-pro");
  const fast = ltx.find((m) => m.id === "ltx-fast");
  assert.ok(fast);
  assert.equal(fast!.modality, "video");
  assert.equal(fast!.invocation, "poll");
  assert.equal(fast!.maxDurationS, 20);
  assert.ok(fast!.capabilities.includes("native_audio"));
  assert.ok(fast!.capabilities.includes("image_to_video"));
  assert.ok(reg.find((m) => m.id === "ltx-pro")!.capabilities.includes("lipdub"));
});

test("providerHint=ltx pins the brief to an LTX model", () => {
  const brief: GenerationBrief = { modality: "video", durationS: 6, providerHint: "ltx" };
  const decision = chooseModel(brief, defaultRegistry());
  assert.equal(decision.model.provider, "ltx");
});

test("submit routes text-to-video when there is no anchor, native audio on, vertical default", async () => {
  const { fn, calls } = fakeFetch();
  const client = makeEdgeProviderClient(CFG, fn);
  const model = defaultRegistry().find((m) => m.id === "ltx-fast")!;
  const sub = await client.submit({ model, params: { prompt: "a fox runs", durationS: 6 } });
  assert.equal(sub.status, "pending");
  assert.ok(sub.status === "pending" && sub.handle === "ltx:text-to-video:job-123");
  const start = calls.find((c) => c.body.action === "start")!;
  assert.equal(start.body.model, "ltx-2-3-fast");
  assert.equal(start.body.duration, 6);
  assert.equal(start.body.generateAudio, true);
  assert.equal(start.body.resolution, "1080x1920");
  assert.ok(!("imageUri" in start.body));
});

test("submit routes image-to-video when an anchor (first frame) is supplied, carrying it as imageUri", async () => {
  const { fn, calls } = fakeFetch();
  const client = makeEdgeProviderClient(CFG, fn);
  const model = defaultRegistry().find((m) => m.id === "ltx-fast")!;
  const sub = await client.submit({ model, params: { prompt: "she turns", anchorUrl: "https://cdn/last.jpg", durationS: 5 } });
  assert.ok(sub.status === "pending" && sub.handle === "ltx:image-to-video:job-123");
  const start = calls.find((c) => c.body.action === "start")!;
  assert.equal(start.body.imageUri, "https://cdn/last.jpg");
});

test("native audio can be turned off (when an external dub will be muxed)", async () => {
  const { fn, calls } = fakeFetch();
  const client = makeEdgeProviderClient(CFG, fn);
  const model = defaultRegistry().find((m) => m.id === "ltx-fast")!;
  await client.submit({ model, params: { prompt: "x", generateAudio: false } });
  assert.equal(calls.find((c) => c.body.action === "start")!.body.generateAudio, false);
});

test("poll parses the endpoint-carrying handle and re-hosts the completed video to a durable url", async () => {
  const { fn } = fakeFetch({ lastFrameUrl: null });
  const client = makeEdgeProviderClient(CFG, fn);
  const done = await client.poll("ltx:text-to-video:job-123");
  assert.equal(done.status, "done");
  assert.ok(done.status === "done");
  // re-hosted into the public videos bucket (not the ephemeral googleapis url)
  assert.match((done as { output: { outputUrl: string } }).output.outputUrl, /\/storage\/v1\/object\/public\/videos\//);
});

test("runModel drives an LTX poll generation end to end through the normalizer", async () => {
  const { fn } = fakeFetch();
  const client = makeEdgeProviderClient(CFG, fn);
  const model = defaultRegistry().find((m) => m.id === "ltx-pro")!;
  const out = await runModel({ model, params: { prompt: "neon city", durationS: 7 } }, { client });
  assert.equal(out.provider, "ltx");
  assert.equal(out.model_id, "ltx-2-3-pro");
  assert.equal(out.cached, false);
  assert.match(out.outputUrl, /public\/videos\//);
});

test("a failed LTX start surfaces as a thrown provider error (so the episode loop falls back)", async () => {
  const { fn } = fakeFetch({ failStart: true });
  const client = makeEdgeProviderClient(CFG, fn);
  const model = defaultRegistry().find((m) => m.id === "ltx-fast")!;
  await assert.rejects(() => client.submit({ model, params: { prompt: "x" } }), /ltx/);
});
