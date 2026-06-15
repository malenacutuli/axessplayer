// C2PA manifest tests. The manifest is the clear interface W8 hands to W9: W9 signs it and records it in
// content_credentials. W8 leaves signature null (signing is W9's job). The asserts here pin the handoff
// contract: binding to the row, content hash, tier mapping, AI-generated flag, and the unsigned state.
// No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildManifest, CLAIM_GENERATOR } from "../src/c2pa.js";
import type { MediaArtifact } from "../src/backends.js";

const NOW = () => new Date("2026-06-15T00:00:00.000Z");

function artifact(): MediaArtifact {
  return {
    playback_url: "https://cdn.example/gen/abc/x.m3u8",
    duration_ms: 1000,
    content_hash: "sha256:cafef00d",
    steps: ["decode", "dubbing_synthesize", "encode_hls"],
    generator: "fake-dubbing-v0",
  };
}

test("manifest binds to the variant row and carries the content hash", () => {
  const m = buildManifest({
    beatVariantId: "cccccccc-0000-0000-0000-0000000000aa",
    tier: "A_filmed",
    kind: "dubbing",
    artifact: artifact(),
    source_url: "https://cdn.example/spine/x.mov",
    now: NOW,
  });
  assert.equal(m.manifest_version, "1.0");
  assert.equal(m.beat_variant_id, "cccccccc-0000-0000-0000-0000000000aa");
  assert.equal(m.content_hash, "sha256:cafef00d");
  assert.equal(m.claim_generator, CLAIM_GENERATOR);
  assert.equal(m.asset_generator, "fake-dubbing-v0");
});

test("W8 leaves the signature null for W9 to sign", () => {
  const m = buildManifest({
    beatVariantId: "cccccccc-0000-0000-0000-0000000000aa",
    tier: "A_filmed",
    kind: "captions",
    artifact: artifact(),
    source_url: "s",
    now: NOW,
  });
  assert.equal(m.signature, null);
});

test("ai_generated is false for filmed, true for likeness and ai tiers", () => {
  const base = { beatVariantId: "x", artifact: artifact(), source_url: "s", now: NOW } as const;
  assert.equal(buildManifest({ ...base, tier: "A_filmed", kind: "dubbing" }).ai_generated, false);
  assert.equal(buildManifest({ ...base, tier: "B_likeness", kind: "pov" }).ai_generated, true);
  assert.equal(buildManifest({ ...base, tier: "C_ai", kind: "pov" }).ai_generated, true);
});

test("the created action maps tier to the right IPTC source type", () => {
  const base = { beatVariantId: "x", artifact: artifact(), source_url: "s", now: NOW } as const;
  const filmed = buildManifest({ ...base, tier: "A_filmed", kind: "dubbing" });
  const ai = buildManifest({ ...base, tier: "C_ai", kind: "pov" });
  assert.equal(filmed.actions[0].action, "c2pa.created");
  assert.equal(filmed.actions[0].digitalSourceType, "digitalCapture");
  assert.equal(ai.actions[0].digitalSourceType, "trainedAlgorithmicMedia");
});

test("the encode step is recorded as a transcode action", () => {
  const m = buildManifest({
    beatVariantId: "x",
    tier: "A_filmed",
    kind: "dubbing",
    artifact: artifact(),
    source_url: "s",
    now: NOW,
  });
  assert.ok(m.actions.some((a) => a.action === "c2pa.transcoded"));
  // the parent ingredient is the source spine segment.
  assert.equal(m.ingredients[0].url, "s");
  assert.equal(m.ingredients[0].relationship, "parentOf");
});

test("created_at is deterministic when now is pinned", () => {
  const m = buildManifest({
    beatVariantId: "x",
    tier: "A_filmed",
    kind: "dubbing",
    artifact: artifact(),
    source_url: "s",
    now: NOW,
  });
  assert.equal(m.created_at, "2026-06-15T00:00:00.000Z");
});
