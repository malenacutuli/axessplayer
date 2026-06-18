// POST /analyze : the read-only first half of "one click". It probes the source, detects a scene
// timeline, scores every capability, and proposes a tiered action plan WITHOUT touching a pixel. The
// operator then enqueues one of the proposed actions via POST /jobs. Pure and deterministic so it
// unit-tests; the real probe/scene-detection backends are injected (a deterministic fake here). No em
// dashes.

import type { Capability } from "./tiers.js";
import { ALL_CAPABILITIES, tierOf } from "./tiers.js";
import { scoreConfidence, type ConfidenceSignals } from "./confidence.js";
import { estimateCost } from "./cost.js";

export interface SourceProbe {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  codec: string;
}

export interface Scene {
  idx: number;
  startMs: number;
  endMs: number;
  shotClass: "wide" | "medium" | "close" | "insert";
  hasFace: boolean;
  hasLogo: boolean;
}

export interface ProposedAction {
  capability: Capability;
  tier: ReturnType<typeof tierOf>;
  confidence: ReturnType<typeof scoreConfidence>["band"];
  mode: ReturnType<typeof scoreConfidence>["mode"];
  confidenceScore: number;
  lowConfidenceFlagged: boolean;
  estimatedUsd: number;
}

export interface AnalysisResult {
  probe: SourceProbe;
  scenes: Scene[];
  proposed: ProposedAction[];
}

// The probe + scene backend, injected. Production wires the real technical probe + scene detector; tests
// inject a deterministic fake.
export interface AnalyzeBackend {
  probe(assetUrl: string): Promise<SourceProbe>;
  detectScenes(assetUrl: string, probe: SourceProbe): Promise<Scene[]>;
}

// Build per-capability confidence signals from the probe + scenes. This is the only place the raw media
// features turn into scorer inputs, so it is the lever a real model plugs into later.
function signalsFor(capability: Capability, probe: SourceProbe, scenes: Scene[]): ConfidenceSignals {
  const sourceQuality = probe.width >= 1280 && probe.durationMs > 0 ? 0.9 : 0.5;
  const hasScenes = scenes.length > 0;
  const hasFaces = scenes.some((s) => s.hasFace);
  // Tier A capabilities that depend on a transcript/scene timeline get high precondition coverage when
  // those exist; likeness-touching capabilities get low coverage unless faces are actually present.
  let preconditionCoverage = hasScenes ? 0.85 : 0.4;
  if ((capability === "lip_sync" || capability === "actor_replacement" || capability === "identity_across_clips") && !hasFaces) {
    preconditionCoverage = 0.2;
  }
  return { sourceQuality, preconditionCoverage, adapterReliability: 0.8 };
}

export async function analyze(assetUrl: string, backend: AnalyzeBackend, budgetUsd: number | null = null): Promise<AnalysisResult> {
  const probe = await backend.probe(assetUrl);
  const scenes = await backend.detectScenes(assetUrl, probe);
  const proposed: ProposedAction[] = ALL_CAPABILITIES.map((capability) => {
    const signals = signalsFor(capability, probe, scenes);
    const score = scoreConfidence(capability, signals);
    const cost = estimateCost(capability, probe.durationMs, budgetUsd);
    return {
      capability,
      tier: tierOf(capability),
      confidence: score.band,
      mode: score.mode,
      confidenceScore: round3(score.score),
      lowConfidenceFlagged: score.lowConfidenceFlagged,
      estimatedUsd: cost.estimatedUsd,
    };
  });
  return { probe, scenes, proposed };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// A deterministic fake backend for tests and local wiring: a clean 1080p source split into three scenes,
// the middle one carrying a face. Real backends replace this. No em dashes.
export function fakeBackend(): AnalyzeBackend {
  return {
    async probe() {
      return { width: 1920, height: 1080, fps: 24, durationMs: 180000, codec: "h264" };
    },
    async detectScenes(_url, probe) {
      const third = Math.floor(probe.durationMs / 3);
      return [
        { idx: 0, startMs: 0, endMs: third, shotClass: "wide", hasFace: false, hasLogo: true },
        { idx: 1, startMs: third, endMs: third * 2, shotClass: "close", hasFace: true, hasLogo: false },
        { idx: 2, startMs: third * 2, endMs: probe.durationMs, shotClass: "medium", hasFace: false, hasLogo: false },
      ];
    },
  };
}
