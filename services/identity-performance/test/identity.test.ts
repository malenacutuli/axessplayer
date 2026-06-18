// Unit tests for the deterministic identity-consistency / drift SCORER and the lock spec. These exercise the
// drift guard directly over fixed vectors so an INJECTED inconsistency is flagged, and a consistent set is
// not. No socket, no DB. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildLockSpec,
  scoreDrift,
  cosineSimilarity,
  referenceCentroid,
  DRIFT_THRESHOLD,
} from "../src/identity.js";
import type { CharacterIdentity, DerivedShot, IdentityReferences } from "../src/store.js";

function shot(id: string, embedding: number[] | null): DerivedShot {
  return { id, identityId: "i1", kind: "generation", embedding, assetUrl: embedding ? "x" : null, createdAt: "t" };
}

const REFS: IdentityReferences = {
  embeddings: [
    [1, 0, 0],
    [0.9, 0.1, 0],
  ],
  imageUrls: ["sovereign://r1.png"],
  voiceRef: "sovereign://voice",
};

test("cosineSimilarity is 1 for identical direction and 0 for orthogonal", () => {
  assert.equal(cosineSimilarity([1, 2, 3], [2, 4, 6]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("cosineSimilarity is 0 (never NaN) for a zero-magnitude vector", () => {
  assert.equal(cosineSimilarity([0, 0, 0], [1, 1, 1]), 0);
});

test("referenceCentroid averages the reference embeddings", () => {
  const c = referenceCentroid(REFS);
  assert.ok(c != null);
  assert.equal(c![0], 0.95);
  assert.equal(c![1], 0.05);
});

test("buildLockSpec carries the references and a default strength", () => {
  const identity: CharacterIdentity = {
    id: "i1",
    seriesId: "s1",
    characterName: "Maya",
    references: REFS,
    consentRef: "c1",
    realLikeness: true,
    createdAt: "t",
  };
  const spec = buildLockSpec(identity);
  assert.equal(spec.identityId, "i1");
  assert.equal(spec.referenceEmbeddings.length, 2);
  assert.equal(spec.voiceRef, "sovereign://voice");
  assert.ok(spec.strength > 0 && spec.strength <= 1);
});

test("a CONSISTENT set of shots scores high and is NOT flagged", () => {
  const shots = [shot("a", [1, 0, 0]), shot("b", [0.95, 0.05, 0])];
  const report = scoreDrift(REFS, shots, DRIFT_THRESHOLD, "i1");
  assert.equal(report.flagged, false);
  assert.ok(report.minConsistency >= DRIFT_THRESHOLD);
  assert.equal(report.unscorableShotIds.length, 0);
});

test("the drift guard FLAGS an injected inconsistency (a shot below the floor)", () => {
  // The third shot points in an orthogonal direction: a clear identity drift the guard must flag.
  const shots = [shot("a", [1, 0, 0]), shot("b", [0.95, 0.05, 0]), shot("c", [0, 1, 0])];
  const report = scoreDrift(REFS, shots, DRIFT_THRESHOLD, "i1");
  assert.equal(report.flagged, true);
  const drifted = report.perShot.find((s) => s.shotId === "c");
  assert.ok(drifted);
  assert.equal(drifted!.drifted, true);
  assert.ok(report.minConsistency < DRIFT_THRESHOLD);
});

test("a shot with NO produced embedding is reported as unscorable, never counted as passing", () => {
  const shots = [shot("a", [1, 0, 0]), shot("b", null)];
  const report = scoreDrift(REFS, shots, DRIFT_THRESHOLD, "i1");
  assert.deepEqual(report.unscorableShotIds, ["b"]);
  // only the one scorable shot contributes; it is consistent, so not flagged
  assert.equal(report.perShot.length, 1);
  assert.equal(report.flagged, false);
});

test("with no reference embeddings (non-real-likeness) nothing can drift", () => {
  const refs: IdentityReferences = { embeddings: [], imageUrls: [], voiceRef: null };
  const report = scoreDrift(refs, [shot("a", [0, 1, 0])], DRIFT_THRESHOLD, "i1");
  assert.equal(report.flagged, false);
  assert.equal(report.meanConsistency, 1);
});
