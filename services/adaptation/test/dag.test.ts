// DAG state machine units. The hard guarantees enforced in the DAG, not around it:
//   - a rights-missing source is BLOCKED at rights_gate
//   - a Tier C action on hero content parks at human_review (never auto-renders)
//   - an over-budget job pauses at adaptation_plan
//   - a gated adapter REFUSES at full_render without an approved review (no fabricated asset)
//   - a Tier A job drives to publish_ready with an edited-pixels playback url
// No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { drive, DAG_NODES, type JobRecord } from "../src/dag.js";
import { defaultRegistry } from "../src/adapters.js";
import type { RightsChecklist } from "../src/rightsGate.js";

function fullRights(over: Partial<RightsChecklist> = {}): RightsChecklist {
  return {
    ownsFootage: true, actorAdaptationRights: true, voiceRights: true, likenessRights: true,
    musicRights: true, territoryCleared: true, brandLogoCleared: true, aiTransformationAllowed: true,
    ageSensitiveReviewed: true, consentRef: "consent:ok", consentCurrent: true, ...over,
  };
}
function emptyRights(): RightsChecklist {
  return {
    ownsFootage: false, actorAdaptationRights: false, voiceRights: false, likenessRights: false,
    musicRights: false, territoryCleared: false, brandLogoCleared: false, aiTransformationAllowed: false,
    ageSensitiveReviewed: false, consentRef: null, consentCurrent: false,
  };
}

function baseJob(over: Partial<JobRecord>): JobRecord {
  return {
    jobId: "job_1", sourceId: "src_1", capability: "vertical_reframe", tier: "A",
    confidence: "high", confidenceScore: 0.9, lowConfidenceFlagged: false, state: "running",
    currentStage: DAG_NODES[1], estimatedUsd: 0, budgetUsd: null, prompt: null, isHero: false,
    sourceDurationMs: 180000, rights: fullRights(), humanReviewApproved: false,
    variantId: null, playbackUrl: null, ...over,
  };
}

test("a rights-missing source is BLOCKED at rights_gate", async () => {
  const job = baseJob({ rights: emptyRights() });
  const out = await drive(job, defaultRegistry());
  assert.equal(out.state, "blocked");
  assert.equal(out.currentStage, "rights_gate");
});

test("a Tier A action with full rights drives to publish_ready with an edited-pixels url", async () => {
  const job = baseJob({});
  const out = await drive(job, defaultRegistry());
  assert.equal(out.state, "done");
  assert.equal(out.currentStage, "publish_ready");
  assert.equal(out.playbackUrl, "adapted://src_1/vertical_reframe");
  assert.equal(out.variantId, "adv_job_1");
});

test("a Tier C action on HERO content parks at human_review (never auto-renders)", async () => {
  const job = baseJob({
    capability: "actor_replacement", tier: "C", confidence: "low", lowConfidenceFlagged: true,
    isHero: true, prompt: "replace stunt double", humanReviewApproved: false,
  });
  const out = await drive(job, defaultRegistry());
  assert.equal(out.state, "awaiting_review");
  assert.equal(out.currentStage, "human_review");
  assert.equal(out.playbackUrl, null); // nothing rendered
});

test("an over-budget job pauses at adaptation_plan", async () => {
  const job = baseJob({ capability: "actor_replacement", tier: "C", lowConfidenceFlagged: true, budgetUsd: 1, prompt: "x" });
  const out = await drive(job, defaultRegistry());
  // It reaches adaptation_plan and pauses there before any review/render.
  assert.equal(out.state, "paused_over_budget");
  assert.equal(out.currentStage, "adaptation_plan");
});

test("an APPROVED Tier C job still does not fabricate an asset (gated adapter refuses, no backend)", async () => {
  // Approved + reviewed + low-conf flagged, within budget. The gated adapter has no generative backend,
  // so full_render REFUSES rather than inventing media: the job fails, no playbackUrl.
  const job = baseJob({
    capability: "actor_replacement", tier: "C", confidence: "low", lowConfidenceFlagged: true,
    isHero: false, prompt: "x", humanReviewApproved: true, budgetUsd: null,
  });
  const out = await drive(job, defaultRegistry());
  assert.equal(out.state, "failed");
  assert.equal(out.currentStage, "full_render");
  assert.equal(out.playbackUrl, null);
});

test("the DAG lists every required node in order", () => {
  assert.equal(DAG_NODES[0], "source_ingest");
  assert.equal(DAG_NODES[1], "rights_gate");
  assert.equal(DAG_NODES[DAG_NODES.length - 1], "publish_ready");
  assert.ok(DAG_NODES.includes("c2pa_signing"));
  assert.ok(DAG_NODES.includes("preview_render"));
  assert.ok(DAG_NODES.includes("variant_registration"));
});
