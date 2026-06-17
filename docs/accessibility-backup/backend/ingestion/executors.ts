// Real-executor wiring for the ingest orchestrator. Maps each stage to (a) the media-dir filename the
// accessibility pipeline produces by convention, and (b) the 0009a track field it registers on the
// beat_variant. The executor is EXISTING-ASSET-AWARE: if the derivative is already in the media dir (from
// a prior run or the offline pipeline) it is referenced at zero cost (idempotent over produced assets);
// otherwise the injected builder runs (the real build-captions/-ad/-sign/-dub, behind the cost gate). The
// heavy I/O (the edge functions, ffmpeg, pg, C2PA) is injected so this stays pure and testable. No em dashes.

import type { Stage } from "./stages.js";
import type { RunPorts, IngestJob } from "./orchestrator.js";

export type TrackField = "caption_doc_url" | "audio_description_url" | "sign_video_url" | "dub_audio_urls";

// The 0009a track field a stage registers on the beat_variant. transcript/character are intermediate
// artifacts (not variant tracks); poster writes series.poster_url, handled separately.
export function stageTrackField(stage: Stage): TrackField | null {
  switch (stage.kind) {
    case "captions": return "caption_doc_url";
    case "ad": return "audio_description_url";
    case "sign": return "sign_video_url";
    case "dub": return "dub_audio_urls";
    default: return null;
  }
}

// The media-dir filename for a stage, matching the offline pipeline + media-server layout. The base
// language caption is captions.json; other languages are <lang>_captions.json. Sign is <sl>_sign.webm.
export function stageArtifactFile(stage: Stage, baseLang: string): string | null {
  switch (stage.kind) {
    case "transcript": return "transcript.json";
    case "character": return "characters.json";
    case "poster": return "poster.jpg";
    case "captions": return stage.lang === baseLang ? "captions.json" : `${stage.lang}_captions.json`;
    case "ad": return stage.lang === baseLang ? "ad.json" : `${stage.lang}_ad.json`;
    case "sign": return `${(stage.signLanguage ?? "ASL").toLowerCase()}_sign.webm`;
    case "dub": return `${stage.lang}_dub.m4a`;
    default: return null;
  }
}

export interface ExecutorDeps {
  baseLang: string;
  mediaDirUrl: string; // ".../media/<id>/"
  presentFiles: string[]; // from the media-server /tracks listing
  // The real builder for a missing artifact (build-captions/-ad/-sign/-dub / a generate-* edge function).
  // Returns the produced filename and the actual cost. Behind the cost gate via the orchestrator.
  build(stage: Stage): Promise<{ file: string; costUsd: number }>;
}

// Build the orchestrator execute port. Existing assets are referenced at zero cost (idempotent); missing
// ones invoke the builder.
export function makeExecutor(deps: ExecutorDeps): RunPorts["execute"] {
  return async (stage: Stage) => {
    const expected = stageArtifactFile(stage, deps.baseLang);
    if (expected && deps.presentFiles.includes(expected)) {
      return { artifact: `${deps.mediaDirUrl}${expected}`, costUsd: 0 }; // already produced
    }
    const built = await deps.build(stage);
    return { artifact: `${deps.mediaDirUrl}${built.file}`, costUsd: built.costUsd };
  };
}

export interface RegistrarDeps {
  // Set a 0009a track field on the beat_variant (dub sets the per-language map entry). Injected; the real
  // impl writes mobile.beat_variants and C2PA-signs the artifact via the trust service.
  setTrackField(variantId: string, field: TrackField, value: string, lang?: string): Promise<void>;
  setSeriesPoster(seriesId: string, posterUrl: string): Promise<void>;
  c2paSign(artifact: string, seriesId: string): Promise<void>;
  variantIdForBeat?: string; // the variant being assembled (the cold-open / base variant for the series)
}

// Build the orchestrator register port: each produced artifact lands on the variant via its 0009a field
// and is C2PA-signed. The transcript/character intermediates are not registered as tracks.
export function makeRegistrar(deps: RegistrarDeps): NonNullable<RunPorts["register"]> {
  return async (stage: Stage, artifact: string, job: IngestJob) => {
    if (stage.kind === "poster") {
      await deps.setSeriesPoster(job.seriesId, artifact);
      await deps.c2paSign(artifact, job.seriesId);
      return;
    }
    const field = stageTrackField(stage);
    if (!field || !deps.variantIdForBeat) return; // intermediates are not variant tracks
    await deps.setTrackField(deps.variantIdForBeat, field, artifact, stage.lang);
    await deps.c2paSign(artifact, job.seriesId);
  };
}
