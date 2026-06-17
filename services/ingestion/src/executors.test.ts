// Spec test for the real-executor wiring: stage -> 0009a field and -> media filename mapping, the
// existing-asset-aware executor (reference at zero cost, build only the missing), and the registrar that
// lands each artifact on the right variant track field (or the series poster) and C2PA-signs it. The I/O
// is faked. No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { accessibilityStages, type Stage } from "./stages.js";
import { stageTrackField, stageArtifactFile, makeExecutor, makeRegistrar } from "./executors.js";
import type { IngestJob } from "./orchestrator.js";

const stage = (over: Partial<Stage>): Stage => ({ id: over.id ?? "s", kind: over.kind ?? "captions", deps: [], generates: true, estimateUsd: 0.1, ...over });
const job: IngestJob = { jobId: "j", seriesId: "series1", tier: "hero", budgetUsd: 100, spentUsd: 0, stages: {} };

describe("stage -> 0009a field + media file", () => {
  it("maps the track-bearing stages to their fields", () => {
    assert.equal(stageTrackField(stage({ kind: "captions" })), "caption_doc_url");
    assert.equal(stageTrackField(stage({ kind: "ad" })), "audio_description_url");
    assert.equal(stageTrackField(stage({ kind: "sign" })), "sign_video_url");
    assert.equal(stageTrackField(stage({ kind: "dub" })), "dub_audio_urls");
    assert.equal(stageTrackField(stage({ kind: "transcript" })), null);
    assert.equal(stageTrackField(stage({ kind: "poster" })), null);
  });
  it("maps stages to the media-dir filenames the pipeline produces", () => {
    assert.equal(stageArtifactFile(stage({ kind: "captions", lang: "en" }), "en"), "captions.json");
    assert.equal(stageArtifactFile(stage({ kind: "captions", lang: "es" }), "en"), "es_captions.json");
    assert.equal(stageArtifactFile(stage({ kind: "ad", lang: "en" }), "en"), "ad.json");
    assert.equal(stageArtifactFile(stage({ kind: "sign", signLanguage: "ASL" }), "en"), "asl_sign.webm");
    assert.equal(stageArtifactFile(stage({ kind: "dub", lang: "es" }), "en"), "es_dub.m4a");
  });
});

describe("existing-asset-aware executor", () => {
  const base = { baseLang: "en", mediaDirUrl: "http://m/media/x/", presentFiles: ["captions.json", "asl_sign.webm"] };
  it("references an existing asset at zero cost and never builds it", async () => {
    let built = 0;
    const exec = makeExecutor({ ...base, build: async () => { built++; return { file: "x", costUsd: 9 }; } });
    const r = await exec(stage({ kind: "captions", lang: "en" }), job);
    assert.equal(r.artifact, "http://m/media/x/captions.json");
    assert.equal(r.costUsd, 0);
    assert.equal(built, 0);
  });
  it("builds a missing asset and charges its cost", async () => {
    const exec = makeExecutor({ ...base, build: async () => ({ file: "fr_captions.json", costUsd: 0.2 }) });
    const r = await exec(stage({ kind: "captions", lang: "fr" }), job);
    assert.equal(r.artifact, "http://m/media/x/fr_captions.json");
    assert.equal(r.costUsd, 0.2);
  });
});

describe("registrar lands artifacts on the right field and C2PA-signs", () => {
  it("sets the variant track field for a captions stage and signs it", async () => {
    const calls: string[] = [];
    const reg = makeRegistrar({
      variantIdForBeat: "v1",
      setTrackField: async (vid, field, value, lang) => { calls.push(`field:${vid}:${field}:${lang ?? "-"}:${value}`); },
      setSeriesPoster: async () => { calls.push("poster"); },
      c2paSign: async (a) => { calls.push(`sign:${a}`); },
    });
    await reg(stage({ kind: "dub", lang: "es" }), "http://m/es_dub.m4a", job);
    assert.deepEqual(calls, ["field:v1:dub_audio_urls:es:http://m/es_dub.m4a", "sign:http://m/es_dub.m4a"]);
  });
  it("routes a poster to the series and skips intermediates (transcript)", async () => {
    const calls: string[] = [];
    const reg = makeRegistrar({
      variantIdForBeat: "v1",
      setTrackField: async () => { calls.push("field"); },
      setSeriesPoster: async (sid, url) => { calls.push(`poster:${sid}:${url}`); },
      c2paSign: async () => { calls.push("sign"); },
    });
    await reg(stage({ kind: "poster" }), "http://m/poster.jpg", job);
    await reg(stage({ kind: "transcript" }), "http://m/transcript.json", job);
    assert.deepEqual(calls, ["poster:series1:http://m/poster.jpg", "sign"]); // poster signed; transcript not registered
  });
});

// Sanity: the full hero DAG yields exactly one track-bearing stage per (lang x captions/ad/dub) plus one
// per sign language, so the registrar would attach the complete 0009a set.
describe("DAG coverage", () => {
  it("produces a track-bearing stage for every language track and sign language", () => {
    const stages = accessibilityStages(["en", "es"], ["ASL", "PSL"]);
    const tracked = stages.filter((s) => stageTrackField(s) !== null);
    // 2 langs * (captions+ad+dub = 3) + 2 sign = 8
    assert.equal(tracked.length, 8);
  });
});
