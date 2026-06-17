// The ingest DAG (C17). Stages fan out per target language and per sign language. Each stage declares its
// dependencies, whether it is a cost-bearing GENERATION stage (metered against the budget), whether it is a
// per-language fan-out, and an estimated cost. Stage ids are namespaced so a language switch moves audio +
// captions + AD + sign together. No em dashes.

export type StageKind = "transcript" | "character" | "poster" | "captions" | "ad" | "sign" | "dub";

export interface Stage {
  id: string; // e.g. "transcript", "captions:es", "sign:ASL", "dub:fr"
  kind: StageKind;
  deps: string[];
  generates: boolean; // cost-bearing (LLM/TTS/generation), metered against the cost gate
  estimateUsd: number; // flagged placeholder estimate per stage
  lang?: string; // target spoken language for captions/ad/dub
  signLanguage?: string; // ASL/PSL/LSA/Libras for sign
  tier?: "draft" | "quality"; // sign auto-draft vs human-interpreter quality
}

// FLAGGED placeholder per-stage cost estimates.
const COST = { transcript: 0.2, character: 0.3, poster: 0.1, captions: 0.15, ad: 0.4, sign: 0.5, dub: 0.6 } as const;

// Build the accessibility ingest DAG for a set of target languages and the database sign languages. The
// transcript is the spine; character attribution and per-language tracks hang off it. Sign tracks are the
// auto-draft tier (human clips replace them later via signTier). Every database sign language gets a draft
// regardless of the spoken target languages (C17: draft sign in EVERY database language).
export function accessibilityStages(langs: string[], signLanguages: string[], baseLang?: string): Stage[] {
  const stages: Stage[] = [
    { id: "transcript", kind: "transcript", deps: [], generates: true, estimateUsd: COST.transcript },
    { id: "character", kind: "character", deps: ["transcript"], generates: true, estimateUsd: COST.character },
    { id: "poster", kind: "poster", deps: ["transcript"], generates: true, estimateUsd: COST.poster },
  ];
  for (const lang of langs) {
    stages.push({ id: `captions:${lang}`, kind: "captions", deps: ["transcript", "character"], generates: true, estimateUsd: COST.captions, lang });
    stages.push({ id: `ad:${lang}`, kind: "ad", deps: [`captions:${lang}`], generates: true, estimateUsd: COST.ad, lang });
    // The base language plays its original audio; only non-base languages need a dub.
    if (lang !== baseLang) {
      stages.push({ id: `dub:${lang}`, kind: "dub", deps: [`captions:${lang}`], generates: true, estimateUsd: COST.dub, lang });
    }
  }
  for (const sl of signLanguages) {
    stages.push({ id: `sign:${sl}`, kind: "sign", deps: ["transcript"], generates: true, estimateUsd: COST.sign, signLanguage: sl, tier: "draft" });
  }
  return stages;
}

// Cost tiering (C16): a hero/popular title pre-generates the full set; the long tail generates a minimal
// set up front (transcript, character, poster, the base language tracks, the draft signs) and defers the
// other languages to on-demand. Returns the stage ids to run NOW; the rest are produced lazily and cached.
export function stagesForTier(stages: Stage[], tier: "hero" | "longtail", baseLang: string): Stage[] {
  if (tier === "hero") return stages;
  return stages.filter((s) => {
    if (s.kind === "transcript" || s.kind === "character" || s.kind === "poster") return true;
    if (s.kind === "sign") return true; // drafts are cheap and the accessibility floor
    return s.lang === baseLang; // only the base language tracks up front; other languages on demand
  });
}
