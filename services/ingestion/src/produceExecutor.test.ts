// SLICE A acceptance for the REAL produce executor. With the edge-function fetch + the content PATCH injected
// as fakes, the DAG completes every stage on fake successful outputs (a stage moves to done ONLY on a real
// produced asset URL), fails a stage cleanly on a fake edge-function error, and registers the produced tracks
// onto the variant via the content PATCH. Also exercises the cost gate (a too-small budget stops the run
// without fabricating an asset) and the RealProduceStore enqueue path. No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  runProduceJob,
  normalizeTranscript,
  buildCaptionsDoc,
  buildAdDoc,
  emptyState,
  type EdgeClient,
  type StoragePort,
  type ContentPort,
  type ProduceDeps,
  type ProduceVariant,
  type VariantTrackPatch,
} from "./produceExecutor.js";
import { RealProduceStore, stagesForPlan, type ProduceJob, type CreateJobInput } from "./jobsStore.js";
import { computePlan, type ProduceTargets } from "./produceCost.js";
import { makeProduceRunner } from "./produceRunner.js";

const targets: ProduceTargets = {
  languages: ["en", "es"],
  tracks: { cc: true, ad: true, sign: false, dub: true },
  signLanguages: [],
  costTier: "hero",
};
const variant: ProduceVariant = {
  variantId: "var-1",
  seriesId: "ser-1",
  videoUrl: "https://example.test/source.mp4",
  languages: ["en", "es"],
};

// A fake ASR result in the Deepgram channels/alternatives shape with word timestamps.
const fakeAsr = {
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: "HELLO there friend",
            words: [
              { word: "HELLO", start: 0.0, end: 0.4 },
              { word: "there", start: 0.5, end: 0.9 },
              { word: "friend", start: 2.0, end: 2.6 },
            ],
          },
        ],
      },
    ],
  },
};

function fakeEdge(over: Partial<EdgeClient> = {}): EdgeClient {
  return {
    transcribe: async () => fakeAsr,
    dub: async (_t, lang) => ({ translatedText: `t-${lang}`, audioBase64: Buffer.from(`audio-${lang}`).toString("base64") }),
    audioDescriptions: async () => ({ segments: [{ text: "A door opens.", startTime: 1.0, endTime: 1.8 }] }),
    poster: async () => new Uint8Array([1, 2, 3, 4]),
    ...over,
  };
}

function fakeStorage(uploaded: string[]): StoragePort {
  return {
    upload: async (file) => {
      uploaded.push(file);
      return `https://cdn.test/produced/${file}`;
    },
  };
}

function fakeContent(rec: { patches: Array<[string, VariantTrackPatch]>; posters: Array<[string, string]> }): ContentPort {
  return {
    patchTracks: async (variantId, tracks) => {
      rec.patches.push([variantId, tracks]);
    },
    setSeriesPoster: async (seriesId, posterUrl) => {
      rec.posters.push([seriesId, posterUrl]);
    },
  };
}

function freshJob(): ProduceJob {
  const plan = computePlan(targets, 1);
  return {
    jobId: "j",
    seriesId: variant.seriesId,
    episodeId: null,
    kind: "produce",
    stages: stagesForPlan(plan),
    state: "queued",
    estimatedUsd: plan.estimatedUsd,
  };
}

describe("normalizeTranscript", () => {
  it("normalizes the Deepgram channels/alternatives shape into words + segments", () => {
    const t = normalizeTranscript(fakeAsr);
    assert.equal(t.words.length, 3);
    assert.equal(t.words[0].word, "HELLO");
    // the 1.1s gap before "friend" splits into two segments
    assert.equal(t.segments.length, 2);
    assert.match(t.text, /HELLO there friend/);
  });
  it("normalizes a flat { words } shape and a whisper { segments } shape", () => {
    assert.equal(normalizeTranscript({ words: [{ word: "a", start: 0, end: 1 }] }).words.length, 1);
    const w = normalizeTranscript({ segments: [{ text: "hi", words: [{ word: "hi", start: 0, end: 1 }] }] });
    assert.equal(w.words.length, 1);
    assert.equal(w.text, "hi");
  });
});

describe("buildCaptionsDoc / buildAdDoc", () => {
  it("captions doc carries per-word intensity and an ALL-CAPS word screams", () => {
    const doc = buildCaptionsDoc(normalizeTranscript(fakeAsr)) as any;
    assert.equal(doc.version, 2);
    const words = doc.segments.flatMap((s: any) => s.words);
    const hello = words.find((w: any) => w.text === "HELLO");
    assert.equal(hello.intensity, "screaming");
  });
  it("ad doc normalizes twelve-labs segments", () => {
    const doc = buildAdDoc({ segments: [{ text: "x", startTime: 1, endTime: 2 }] }) as any;
    assert.equal(doc.segments.length, 1);
    assert.equal(doc.segments[0].text, "x");
  });
});

describe("runProduceJob over fake edge functions + content PATCH", () => {
  it("completes every stage on real outputs and registers the produced tracks", async () => {
    const job = freshJob();
    const uploaded: string[] = [];
    const rec = { patches: [] as Array<[string, VariantTrackPatch]>, posters: [] as Array<[string, string]> };
    const deps: ProduceDeps = {
      edge: fakeEdge(),
      storage: fakeStorage(uploaded),
      content: fakeContent(rec),
      variant,
      state: emptyState(),
      budgetUsd: 100,
    };
    await runProduceJob(job, deps);

    assert.equal(job.state, "done", JSON.stringify(job.stages));
    for (const s of job.stages) {
      assert.equal(s.status, "done", `${s.name} not done`);
      assert.ok(s.assetId && s.assetId.length > 0, `${s.name} has no asset`);
    }
    // real artifacts were uploaded
    assert.ok(uploaded.includes("captions.json"));
    assert.ok(uploaded.includes("ad.json"));
    assert.ok(uploaded.includes("es_dub.m4a"));
    assert.ok(uploaded.includes("poster.jpg"));
    // poster was set on the series
    assert.deepEqual(rec.posters[0][0], variant.seriesId);
    // the register stage PATCHed the produced tracks onto the variant
    assert.equal(rec.patches.length, 1);
    const [vid, tracks] = rec.patches[0];
    assert.equal(vid, variant.variantId);
    assert.ok(tracks.caption_doc_url?.endsWith("captions.json"));
    assert.ok(tracks.audio_description_url?.endsWith("ad.json"));
    assert.equal(tracks.dub_audio_urls?.es, "https://cdn.test/produced/es_dub.m4a");
  });

  it("fails a stage cleanly when the edge function errors (no fabricated asset)", async () => {
    const job = freshJob();
    const rec = { patches: [] as Array<[string, VariantTrackPatch]>, posters: [] as Array<[string, string]> };
    const deps: ProduceDeps = {
      edge: fakeEdge({ transcribe: async () => { throw new Error("deepgram 500"); } }),
      storage: fakeStorage([]),
      content: fakeContent(rec),
      variant,
      state: emptyState(),
      budgetUsd: 100,
    };
    await runProduceJob(job, deps);
    assert.equal(job.state, "failed");
    const transcript = job.stages.find((s) => s.name === "transcript")!;
    assert.equal(transcript.status, "failed");
    assert.equal(transcript.assetId, null);
    // no tracks registered on a failed run
    assert.equal(rec.patches.length, 0);
  });

  it("the cost gate stops the run without fabricating an asset, and a budget bump resumes it", async () => {
    const job = freshJob();
    const uploaded: string[] = [];
    const rec = { patches: [] as Array<[string, VariantTrackPatch]>, posters: [] as Array<[string, string]> };
    const state = emptyState();
    const ports = { edge: fakeEdge(), storage: fakeStorage(uploaded), content: fakeContent(rec), variant, state };
    // budget only covers the transcript (0.03); the next cost-bearing stage is gated.
    await runProduceJob(job, { ...ports, budgetUsd: 0.03 });
    assert.equal(job.state, "running");
    assert.equal(job.stages.find((s) => s.name === "transcript")!.status, "done");
    assert.ok(job.stages.some((s) => s.status === "running"));
    // open the budget and resume the SAME job + state: it finishes, transcript is not re-run.
    await runProduceJob(job, { ...ports, budgetUsd: 100 });
    assert.equal(job.state, "done");
    // transcript uploaded nothing (captions/ad/dub/poster did); transcript stage did not re-transcribe
    assert.equal(state.transcript!.words.length, 3);
  });
});

describe("RealProduceStore enqueues a real run on POST /produce", () => {
  it("create kicks off the run; GET reflects completion and tracks are registered", async () => {
    const uploaded: string[] = [];
    const rec = { patches: [] as Array<[string, VariantTrackPatch]>, posters: [] as Array<[string, string]> };
    const runner = makeProduceRunner({ edge: fakeEdge(), storage: fakeStorage(uploaded), content: fakeContent(rec) });
    const store = new RealProduceStore(runner);
    const input: CreateJobInput = {
      seriesId: variant.seriesId,
      targets,
      beats: 1,
      variant: { variantId: variant.variantId, videoUrl: variant.videoUrl },
    };
    const { job } = await store.create(input);
    // the run is fire-and-forget; let the microtask queue drain.
    await new Promise((r) => setTimeout(r, 20));
    const got = await store.get(job.jobId);
    assert.equal(got?.state, "done", JSON.stringify(got?.stages));
    assert.equal(rec.patches.length, 1);
    assert.equal(store.wired, true);
    assert.equal((await store.list()).length, 1);
  });

  it("without a variant, create returns the preview only and runs nothing", async () => {
    const rec = { patches: [] as Array<[string, VariantTrackPatch]>, posters: [] as Array<[string, string]> };
    const runner = makeProduceRunner({ edge: fakeEdge(), storage: fakeStorage([]), content: fakeContent(rec) });
    const store = new RealProduceStore(runner);
    const { job, plan } = await store.create({ seriesId: variant.seriesId, targets, beats: 1 });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(job.state, "queued");
    assert.equal(rec.patches.length, 0);
    assert.ok(plan.estimatedUsd > 0);
  });
});
