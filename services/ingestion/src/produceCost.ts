// The fan-out plan + cost estimate for a POST /produce request (the JOB API CONTRACT). Pure: given the
// produce targets it computes the per-stage fan-out plan and the estimated USD, so the UI can show the
// COST-BEFORE-COMMIT preview before anything is enqueued. The cost constants are COPIED (not imported) from
// services/content handleProduceSeries / services/ingestion costModel.ts so this service never depends on a
// live service. FLAGGED: swap each estimate for the contracted per-call price when it lands. No em dashes.

// Per-stage USD estimate, mirroring services/content/src/content.ts PRODUCE_COST and costModel.ts. Copied
// by value on purpose: the content service is one of the 5 live services and must not be imported.
export const PRODUCE_COST_USD: Record<string, number> = {
  transcript: 0.03,
  poster: 0.04,
  captions: 0.04,
  ad: 0.35,
  dub: 0.45,
  sign: 0.2,
};

// The DAG stage names, in execution order, that a produce job advances through (the JOB API CONTRACT
// stages). transcript is the spine; cwi (captions w/ intensity), ad, dubbing, sign hang off it; poster,
// register (0009a + C2PA), and publish close it out.
export const DAG_STAGE_ORDER = [
  "transcript",
  "captions",
  "cwi",
  "ad",
  "dubbing",
  "sign",
  "poster",
  "register",
  "publish",
] as const;
export type DagStageName = (typeof DAG_STAGE_ORDER)[number];

// Which track each track-bearing target turns on. The contract targets.tracks is { cc, ad, sign, dub }.
export interface ProduceTracks {
  cc?: boolean; // closed captions (CWI: captions with word-level intensity)
  ad?: boolean; // audio description
  sign?: boolean; // sign-language track
  dub?: boolean; // dubbing
}

export interface ProduceTargets {
  languages: string[]; // spoken/caption languages; the first is the base language (original audio)
  tracks: ProduceTracks;
  signLanguages: string[]; // ASL / PSL / LSA / Libras
  costTier?: string; // "hero" | "standard" (a.k.a. longtail); display + tiering hint, default "standard"
}

export interface PlanStage {
  name: DagStageName;
  count: number; // fan-out units (per language / per sign language / per beat-unit)
  eachUsd: number; // copied per-unit estimate (flagged)
  costUsd: number; // count * eachUsd, rounded to cents
  costBearing: boolean; // a generation stage metered against the cost gate
}

export interface ProducePlan {
  stages: PlanStage[];
  stageCount: number; // total fan-out units across cost-bearing stages
  estimatedUsd: number; // the COST-BEFORE-COMMIT total
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Normalize a raw request body into validated targets, or return an error string. The base language plays
// its original audio, so it is never dubbed; only non-base languages fan out a dub stage.
export function parseTargets(raw: unknown): { targets: ProduceTargets } | { error: string } {
  if (raw == null || typeof raw !== "object") return { error: "invalid_body" };
  const b = raw as Record<string, unknown>;
  const t = (b.targets ?? b) as Record<string, unknown>; // accept {targets:{...}} or a bare targets object
  const languages = Array.isArray(t.languages) ? t.languages.filter((x): x is string => typeof x === "string") : [];
  if (languages.length === 0) return { error: "no_languages" };
  const rawTracks = (t.tracks ?? {}) as Record<string, unknown>;
  const tracks: ProduceTracks = {
    cc: rawTracks.cc === true,
    ad: rawTracks.ad === true,
    sign: rawTracks.sign === true,
    dub: rawTracks.dub === true,
  };
  const signLanguages = Array.isArray(t.signLanguages)
    ? t.signLanguages.filter((x): x is string => typeof x === "string")
    : [];
  const costTier = typeof t.costTier === "string" ? t.costTier : "standard";
  return { targets: { languages, tracks, signLanguages, costTier } };
}

// Compute the fan-out plan + estimatedUsd for the chosen targets. `beats` is the real beat count of the
// episode/series (the per-beat fan-out unit); default 1 when unknown so the preview is still meaningful.
// transcript fans out per beat; captions/cwi/ad per (beat x language); dubbing per (beat x non-base
// language); sign per (beat x sign language); poster once; register/publish are bookkeeping stages (no
// per-unit generation cost).
export function computePlan(targets: ProduceTargets, beats = 1): ProducePlan {
  const b = Math.max(1, beats);
  const langs = targets.languages;
  const baseLang = langs[0];
  const nonBase = langs.filter((l) => l !== baseLang).length;
  const signCount = targets.signLanguages.length;

  const stages: PlanStage[] = [];
  const add = (name: DagStageName, count: number, eachUsd: number, costBearing: boolean) => {
    stages.push({ name, count, eachUsd, costUsd: round2(count * eachUsd), costBearing });
  };

  add("transcript", b, PRODUCE_COST_USD.transcript, true);
  if (targets.tracks.cc) {
    add("captions", b * langs.length, PRODUCE_COST_USD.captions, true);
    add("cwi", b * langs.length, PRODUCE_COST_USD.captions, true); // word-level intensity pass over captions
  }
  if (targets.tracks.ad) add("ad", b * langs.length, PRODUCE_COST_USD.ad, true);
  if (targets.tracks.dub && nonBase > 0) add("dubbing", b * nonBase, PRODUCE_COST_USD.dub, true);
  if (targets.tracks.sign && signCount > 0) add("sign", b * signCount, PRODUCE_COST_USD.sign, true);
  add("poster", 1, PRODUCE_COST_USD.poster, true);
  add("register", 0, 0, false); // 0009a track-field writes + C2PA signing: bookkeeping, no per-unit cost
  add("publish", 0, 0, false); // Article 50 label + go-live: bookkeeping

  const stageCount = stages.reduce((n, s) => n + s.count, 0);
  const estimatedUsd = round2(stages.reduce((s, p) => s + p.costUsd, 0));
  return { stages, stageCount, estimatedUsd };
}
