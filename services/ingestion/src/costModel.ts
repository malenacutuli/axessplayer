// Calibrated per-stage cost model for the REAL edge functions (transcribe, generate-ad, generate-ad-audio,
// generate-dubbing, tts, generate-thumbnail) and the build-* pipeline. These are realistic-order USD
// estimates per episode/beat unit so the cost gate pauses an ACTUAL run, not just a $0 simulation. FLAGGED:
// swap each for the contracted per-call price when it lands. The numbers are intentionally conservative
// (high) so the budget never silently overruns. No em dashes.

import type { StageKind } from "./stages.js";

// Per-stage USD estimate, calibrated to the real services (flagged):
//  transcript  ASR over a 3-5 min clip (Whisper/Deepgram)         ~ $0.03
//  character   one LLM script read for speaker attribution        ~ $0.05
//  poster      one image/thumbnail generation                     ~ $0.04
//  captions    build-captions DSP + LLM intensity tagging / lang  ~ $0.04
//  ad          generate-ad LLM authoring + generate-ad-audio TTS  ~ $0.35
//  dub         generate-dubbing performance-aware dub / language   ~ $0.45
//  sign        build-sign concatenation (compute, owned dict)     ~ $0.20
export const STAGE_COST_USD: Record<StageKind, number> = {
  transcript: 0.03,
  character: 0.05,
  poster: 0.04,
  captions: 0.04,
  ad: 0.35,
  dub: 0.45,
  sign: 0.2,
};

export function stageCostUsd(kind: StageKind): number {
  return STAGE_COST_USD[kind];
}

// Total estimated cost of a full ingest (the sum of its stage estimates). Used to surface the cumulative
// ingest spend per series before a run and to size a budget.
export function estimateIngestCostUsd(stageKinds: StageKind[]): number {
  return stageKinds.reduce((sum, k) => sum + STAGE_COST_USD[k], 0);
}
