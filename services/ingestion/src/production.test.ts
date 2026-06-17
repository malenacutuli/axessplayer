// Pre-live tests for the real wiring: (1) the cost gate is calibrated to realistic edge-function prices and
// PAUSES a realistic-cost run (not a $0 simulation); (2) the production registrar keeps C2PA signing and
// consent-reference writes behind the consent/provenance go-live gate, attaching the track URL but not
// signing/writing consent until live. No em dashes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { accessibilityStages, type Stage } from "./stages.js";
import { estimateIngestCostUsd, STAGE_COST_USD } from "./costModel.js";
import { initJob, runJob, isComplete, type RunPorts } from "./orchestrator.js";
import { makeExecutor } from "./executors.js";
import { registerOne, type ProductionRegistrarDeps } from "./trustRegistrar.js";
import type { IngestJob } from "./orchestrator.js";

describe("calibrated cost gate pauses a realistic-cost run", () => {
  const langs = ["en", "es", "fr", "de", "it", "pt"];
  const sign = ["ASL", "PSL", "LSA"];
  const stages = accessibilityStages(langs, sign, "en");
  // every stage is a fresh generation (nothing pre-produced), so the run costs the full calibrated total.
  const buildExec: RunPorts["execute"] = makeExecutor({
    baseLang: "en",
    mediaDirUrl: "http://m/",
    presentFiles: [],
    build: async (s: Stage) => ({ file: `${s.id}.out`, costUsd: STAGE_COST_USD[s.kind] }),
  });

  it("the full hero ingest has a realistic, non-zero cost", () => {
    const total = estimateIngestCostUsd(stages.map((s) => s.kind));
    assert.ok(total > 3, `expected a realistic total, got ${total}`); // dub+ad x 5 langs dominate
  });

  it("a budget below the realistic total PAUSES the run partway (not a $0 simulation)", async () => {
    const total = estimateIngestCostUsd(stages.map((s) => s.kind));
    const job = initJob("j", "s", "hero", total / 2, stages); // cap at half the real cost
    const res = await runJob(job, stages, { execute: buildExec });
    assert.equal(res.paused, true);
    assert.match(res.pausedReason ?? "", /cost gate/);
    assert.equal(isComplete(job), false);
    assert.ok(job.spentUsd > 0 && job.spentUsd <= total / 2);
  });

  it("opening the full budget resumes the same job to completion (no stage run twice)", async () => {
    const total = estimateIngestCostUsd(stages.map((s) => s.kind));
    const job = initJob("j2", "s2", "hero", total / 2, stages);
    const seen = new Map<string, number>();
    const exec: RunPorts["execute"] = makeExecutor({ baseLang: "en", mediaDirUrl: "http://m/", presentFiles: [], build: async (s) => { seen.set(s.id, (seen.get(s.id) ?? 0) + 1); return { file: `${s.id}.out`, costUsd: STAGE_COST_USD[s.kind] }; } });
    await runJob(job, stages, { execute: exec });
    job.budgetUsd = total + 1; // founder opens the budget
    const res2 = await runJob(job, stages, { execute: exec });
    assert.equal(isComplete(job), true);
    for (const s of stages) assert.equal(seen.get(s.id), 1, `${s.id} ran more than once`);
    assert.ok(Math.abs(job.spentUsd - total) < 1e-9);
  });
});

describe("consent/provenance go-live gate in the production registrar", () => {
  const job: IngestJob = { jobId: "j", seriesId: "series1", tier: "hero", budgetUsd: 100, spentUsd: 0, stages: {} };
  const captionsStage: Stage = { id: "captions:es", kind: "captions", deps: [], generates: true, estimateUsd: 0.04, lang: "es" };
  function makeDeps(live: boolean, consent?: { likenessSubject: string; consentRef: string } | null) {
    const rec = { signed: 0, consents: 0, tracks: [] as string[] };
    const deps: ProductionRegistrarDeps = {
      variantIdForBeat: "v1",
      consentProvenanceLive: live,
      content: { setTrackField: async (_v, f, _val, l) => { rec.tracks.push(`${f}:${l ?? "-"}`); }, setSeriesPoster: async () => {} },
      trust: { recordProvenance: async () => { rec.signed++; }, appendConsent: async () => { rec.consents++; } },
      consentRefFor: () => consent ?? null,
    };
    return { deps, rec };
  }

  it("when NOT live: attaches the track URL but does NOT C2PA-sign or write consent", async () => {
    const { deps, rec } = makeDeps(false);
    const status = await registerOne(captionsStage, "http://m/es_captions.json", job, deps);
    assert.equal(status.trackWritten, true);
    assert.equal(status.provenanceSigned, false);
    assert.equal(status.consentWritten, false);
    assert.equal(rec.signed, 0);
    assert.deepEqual(rec.tracks, ["caption_doc_url:es"]);
  });

  it("when live: C2PA-signs, and writes the consent reference for a likeness asset", async () => {
    const { deps, rec } = makeDeps(true, { likenessSubject: "actor:x", consentRef: "DPA-1" });
    const status = await registerOne(captionsStage, "http://m/es_captions.json", job, deps);
    assert.equal(status.provenanceSigned, true);
    assert.equal(status.consentWritten, true);
    assert.equal(rec.signed, 1);
    assert.equal(rec.consents, 1);
  });

  it("when live with no likeness consent: signs provenance but writes no consent row", async () => {
    const { deps, rec } = makeDeps(true, null);
    const status = await registerOne(captionsStage, "http://m/es_captions.json", job, deps);
    assert.equal(status.provenanceSigned, true);
    assert.equal(status.consentWritten, false);
    assert.equal(rec.consents, 0);
  });
});
