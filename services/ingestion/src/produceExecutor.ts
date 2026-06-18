// The REAL produce executor for the accessibility factory. Replaces the UNWIRED stub (jobsStore
// unwiredExecutor) with an executor that drives the DAG stage state machine by calling the EXISTING Supabase
// edge functions, porting the proven logic from tools/auto-produce/produce.mjs:
//   transcript -> transcribe-with-deepgram (ASR over a PUBLIC video URL -> word timestamps)
//   captions/cwi -> a transcript -> captions.json CWI builder, uploaded to the thumbnails bucket
//   ad -> twelve-labs-audio-descriptions (vision AD over the PUBLIC video URL) -> ad.json uploaded
//   dubbing -> generate-dubbing {text, targetLanguage} -> decode audioBase64 -> <lang>_dub.m4a uploaded
//   poster -> stability-ai -> poster image uploaded -> series poster set via content
//   register -> PATCH /variants/:id/tracks on the content service (self-healing track attach)
// The executor advances a stage to "done" ONLY on a REAL produced output (an asset URL); a stage that yields
// no asset stays running, a stage that throws fails cleanly. Cost-gated (a stage that would exceed the
// remaining budget is left unrun) and resumable (a stage that already carries an asset is never re-run).
// All heavy I/O (the edge-function fetch + the content PATCH + the storage upload) is injected so this module
// is pure and testable. No em dashes.

import type { DagStageName } from "./produceCost.js";
import { PRODUCE_COST_USD } from "./produceCost.js";
import type { JobStage, ProduceJob, StageOutcome } from "./jobsStore.js";

// ---- the transcript shape the builders consume (normalized from whatever the ASR edge fn returns) ----
export interface AsrWord {
  word: string;
  start: number; // seconds
  end: number; // seconds
}
export interface AsrSegment {
  text: string;
  start: number;
  end: number;
  words: AsrWord[];
}
export interface AsrTranscript {
  text: string;
  words: AsrWord[];
  segments: AsrSegment[];
}

// ---- the injected I/O ports (the real impls hit Supabase + the content service; tests inject fakes) ----
export interface EdgeClient {
  // POST <SUPABASE_URL>/functions/v1/transcribe-with-deepgram { videoUrl } -> raw ASR JSON (word timestamps).
  transcribe(videoUrl: string): Promise<unknown>;
  // POST .../generate-dubbing { text, targetLanguage } -> { translatedText, audioBase64 } (MP3 base64).
  dub(text: string, targetLanguage: string): Promise<{ translatedText?: string; audioBase64?: string }>;
  // POST .../twelve-labs-audio-descriptions { videoUrl } -> AD segments (vision audio description).
  audioDescriptions(videoUrl: string): Promise<unknown>;
  // POST .../stability-ai { prompt } -> raw poster image bytes.
  poster(prompt: string): Promise<Uint8Array>;
}

export interface StoragePort {
  // Upload bytes to the PUBLIC thumbnails bucket under <prefix>/<file>; returns the public URL.
  upload(file: string, bytes: Uint8Array, contentType: string): Promise<string>;
}

export interface ContentPort {
  // PATCH <CONTENT_BASE>/variants/:id/tracks with the produced track URLs (self-healing attach).
  patchTracks(variantId: string, tracks: VariantTrackPatch): Promise<void>;
  // Set the series poster (PATCH the series / POST poster) so the produced poster shows on the feed.
  setSeriesPoster(seriesId: string, posterUrl: string): Promise<void>;
}

export interface VariantTrackPatch {
  caption_doc_url?: string;
  audio_description_url?: string;
  sign_video_url?: string;
  dub_audio_urls?: Record<string, string>;
}

// The produce request a job carries: the variant being produced, its PUBLIC video URL, the target languages
// (the first is the base language: original audio, never dubbed) and the produced-asset URLs accumulated so
// far (resume state, so a stage already produced is referenced, not re-run).
export interface ProduceVariant {
  variantId: string;
  seriesId: string;
  videoUrl: string; // PUBLIC URL the edge functions read
  languages: string[]; // base language first
  signLanguages?: string[];
}

export interface ProduceDeps {
  edge: EdgeClient;
  storage: StoragePort;
  content: ContentPort;
  variant: ProduceVariant;
  // Accumulated produced state across stages/ticks (resume + cross-stage data flow). Mutated in place.
  state: ProduceState;
  budgetUsd: number; // remaining budget gate (the job's estimatedUsd is the default cap)
  onLog?(stage: string, msg: string): void;
}

// What the run has produced so far. transcript feeds captions/ad/dub; the URLs feed register.
export interface ProduceState {
  transcript?: AsrTranscript;
  captionDocUrl?: string;
  audioDescriptionUrl?: string;
  dubAudioUrls?: Record<string, string>;
  posterUrl?: string;
  spentUsd: number;
}

export function emptyState(): ProduceState {
  return { spentUsd: 0, dubAudioUrls: {} };
}

// --- transcript normalization: accept the common Deepgram shape (results.channels[].alternatives[].words),
// a flat { words } / { segments } shape, or a whisper-style { segments:[{words}] }; produce a single
// normalized Transcript so the builders never depend on the exact ASR response envelope.
export function normalizeTranscript(raw: unknown): AsrTranscript {
  const r = (raw ?? {}) as Record<string, unknown>;

  // Deepgram: results.channels[0].alternatives[0] { transcript, words:[{word,start,end}] }
  const alt = (((r.results as Record<string, unknown> | undefined)?.channels as unknown[] | undefined)?.[0] as
    | Record<string, unknown>
    | undefined)?.alternatives as unknown[] | undefined;
  const dgAlt = alt?.[0] as Record<string, unknown> | undefined;

  let words: AsrWord[] = [];
  let text = "";

  if (dgAlt && Array.isArray(dgAlt.words)) {
    words = (dgAlt.words as Record<string, unknown>[]).map(toWord);
    text = typeof dgAlt.transcript === "string" ? dgAlt.transcript : wordsToText(words);
  } else if (Array.isArray(r.words)) {
    words = (r.words as Record<string, unknown>[]).map(toWord);
    text = typeof r.text === "string" ? r.text : wordsToText(words);
  } else if (Array.isArray(r.segments)) {
    for (const s of r.segments as Record<string, unknown>[]) {
      for (const w of (Array.isArray(s.words) ? (s.words as Record<string, unknown>[]) : [])) words.push(toWord(w));
    }
    text =
      typeof r.text === "string"
        ? r.text
        : (r.segments as Record<string, unknown>[]).map((s) => String(s.text ?? "").trim()).join(" ").trim();
  } else if (typeof r.transcript === "string") {
    text = r.transcript;
  }

  // Group words into segments on a >0.6s silence gap (sentence-ish), so the captions doc has segments even
  // when the ASR returned only a flat word list.
  const segments: AsrSegment[] = [];
  if (words.length > 0) {
    let cur: AsrWord[] = [];
    for (const w of words) {
      if (cur.length > 0 && w.start - cur[cur.length - 1].end > 0.6) {
        segments.push(toSegment(cur));
        cur = [];
      }
      cur.push(w);
    }
    if (cur.length > 0) segments.push(toSegment(cur));
  }
  if (!text) text = wordsToText(words);
  return { text: text.trim(), words, segments };
}

function toWord(w: Record<string, unknown>): AsrWord {
  return {
    word: String(w.word ?? w.text ?? "").trim(),
    start: Number(w.start ?? w.startTime ?? 0) || 0,
    end: Number(w.end ?? w.endTime ?? 0) || 0,
  };
}
function toSegment(words: AsrWord[]): AsrSegment {
  return {
    text: wordsToText(words),
    start: words[0]?.start ?? 0,
    end: words[words.length - 1]?.end ?? 0,
    words,
  };
}
function wordsToText(words: AsrWord[]): string {
  return words.map((w) => w.word).join(" ").replace(/\s+([.,!?;:])/g, "$1").trim();
}

// --- the transcript -> captions.json CWI builder. Without the PCM (the edge ASR returns timing, not the wav)
// the three Roboto Flex axis signals are derived from the available signals: a word's emphasis (ALL-CAPS or a
// punctuated word) raises intensity; speaking rate (word duration vs the running median) drives energy; both
// feed the 7-level intensity classifier the player's CaptionsWithIntention renderer consumes. The schema
// matches build-captions-generic.mjs (version 2, meta + segments[].words[]). Speaker/emotion/color are LEFT
// OPEN (a single neutral speaker), exactly as the offline generic builder. No em dashes.
const NEUTRAL = "#22E3D0";
export type Intensity = "whisper" | "quiet" | "normal" | "loud" | "yelling" | "screaming";

export function buildCaptionsDoc(transcript: AsrTranscript, speaker = "Speaker"): unknown {
  const allDur = transcript.words.map((w) => Math.max(0.01, w.end - w.start)).sort((a, b) => a - b);
  const medianDur = allDur.length ? allDur[Math.floor(allDur.length / 2)] : 0.3;

  const classify = (w: AsrWord): { intensity: Intensity; energy: number } => {
    const dur = Math.max(0.01, w.end - w.start);
    const clean = w.word.replace(/[^A-Za-z]/g, "");
    const allCaps = clean.length >= 2 && clean === clean.toUpperCase();
    const emphatic = /[!?]$/.test(w.word.trim());
    // a faster word (shorter relative duration) reads as higher energy; ratio in roughly [0.4, 2.0].
    const ratio = medianDur / dur;
    const energy = +Math.min(1, Math.max(0.05, ratio * 0.5)).toFixed(4);
    let intensity: Intensity = "normal";
    if (allCaps) intensity = "screaming";
    else if (emphatic) intensity = "loud";
    else if (ratio > 1.6) intensity = "loud";
    else if (ratio < 0.55) intensity = "quiet";
    return { intensity, energy };
  };

  const segments = transcript.segments.map((s) => {
    const words = s.words.map((w) => {
      const { intensity, energy } = classify(w);
      return {
        text: w.word,
        start_ms: Math.round(w.start * 1000),
        end_ms: Math.round(w.end * 1000),
        startTime: +w.start.toFixed(3),
        endTime: +w.end.toFixed(3),
        character_id: speaker,
        f0_hz: 0, // pitch is unavailable from the ASR word stream; left 0 (open), not fabricated
        energy_rms: energy,
        harmonic_ratio: 0.5,
        intensity,
      };
    });
    return {
      text: s.text,
      speaker,
      speakerColor: NEUTRAL,
      character_id: speaker,
      startTime: +s.start.toFixed(3),
      endTime: +s.end.toFixed(3),
      words,
    };
  });

  const energies = segments.flatMap((s) => s.words.map((w) => w.energy_rms)).filter((e) => e > 0).sort((a, b) => a - b);
  const pct = (arr: number[], q: number) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * q))] : 0);
  const meta = {
    font: "Roboto Flex",
    source: "deepgram",
    energy: { p10: pct(energies, 0.1), p50: pct(energies, 0.5), p90: pct(energies, 0.9), max: energies.at(-1) ?? 0 },
    f0: { p10: 0, p50: 0, p90: 0 },
  };
  return { version: 2, meta, segments };
}

// --- normalize the twelve-labs AD response into the ad.json the player consumes (AudioDescriptionSegment[]).
export function buildAdDoc(raw: unknown): unknown {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawSegs = (Array.isArray(r.segments) ? r.segments : Array.isArray(r.descriptions) ? r.descriptions : []) as Record<
    string,
    unknown
  >[];
  const segments = rawSegs.map((s, i) => {
    const startTime = Number(s.startTime ?? s.start ?? s.at ?? 0) || 0;
    return {
      id: typeof s.id === "string" ? s.id : `ad_${i}`,
      text: String(s.text ?? s.description ?? "").trim(),
      startTime: +startTime.toFixed(2),
      endTime: +(Number(s.endTime ?? s.end ?? startTime) || startTime).toFixed(2),
    };
  });
  return { version: 1, voice: "twelve-labs", segments };
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
function fromBase64(b64: string): Uint8Array {
  // node + browser safe base64 -> bytes
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Resolve the cost of advancing a single stage. Mirrors PRODUCE_COST_USD; bookkeeping stages are free.
export function stageCost(name: DagStageName): number {
  switch (name) {
    case "transcript":
      return PRODUCE_COST_USD.transcript;
    case "captions":
    case "cwi":
      return PRODUCE_COST_USD.captions;
    case "ad":
      return PRODUCE_COST_USD.ad;
    case "dubbing":
      return PRODUCE_COST_USD.dub;
    case "sign":
      return PRODUCE_COST_USD.sign;
    case "poster":
      return PRODUCE_COST_USD.poster;
    default:
      return 0; // register / publish
  }
}

// Run ONE stage to its real output. Returns { assetId } when a real asset was produced (the state machine
// then advances the stage to done), {} when nothing concrete was produced (stage stays running), or throws
// to fail the stage. Cost-gated: a cost-bearing stage that would exceed the remaining budget yields no asset
// (stays running) so a later run with more budget resumes it. Resumable: a stage whose asset already exists
// in state is referenced at zero cost, never re-run. No em dashes.
export async function runStage(stage: JobStage, deps: ProduceDeps): Promise<StageOutcome> {
  const { edge, storage, content, variant, state } = deps;
  const log = (m: string) => deps.onLog?.(stage.name, m);
  const cost = stageCost(stage.name);
  const baseLang = variant.languages[0];

  // Cost gate: do not start a cost-bearing stage that would overrun the budget. Leave it running (no asset)
  // so a budget bump resumes it. Bookkeeping stages (cost 0) always proceed.
  if (cost > 0 && state.spentUsd + cost > deps.budgetUsd) {
    log(`cost gate: ${cost} over remaining ${(deps.budgetUsd - state.spentUsd).toFixed(2)} (paused)`);
    return {}; // no asset; stays running
  }

  switch (stage.name) {
    case "transcript": {
      if (state.transcript) return { assetId: "transcript:cached" };
      log("transcribe-with-deepgram");
      const raw = await edge.transcribe(variant.videoUrl);
      const t = normalizeTranscript(raw);
      if (t.words.length === 0 && !t.text) throw new Error("transcript: empty ASR result");
      state.transcript = t;
      state.spentUsd += cost;
      log(`transcript ready: ${t.words.length} words`);
      return { assetId: `transcript:${t.words.length}w` };
    }

    case "captions":
    case "cwi": {
      // captions builds + uploads captions.json; cwi is the word-intensity pass that the same doc already
      // carries (the builder emits per-word intensity), so cwi reuses the produced caption doc.
      if (stage.name === "cwi" && state.captionDocUrl) return { assetId: state.captionDocUrl };
      if (!state.transcript) throw new Error(`${stage.name}: transcript not produced yet`);
      if (stage.name === "captions" && state.captionDocUrl) return { assetId: state.captionDocUrl };
      const doc = buildCaptionsDoc(state.transcript);
      const url = await storage.upload("captions.json", utf8(JSON.stringify(doc)), "application/json");
      state.captionDocUrl = url;
      if (stage.name === "captions") state.spentUsd += cost;
      log(`uploaded captions.json -> ${url}`);
      return { assetId: url };
    }

    case "ad": {
      if (state.audioDescriptionUrl) return { assetId: state.audioDescriptionUrl };
      log("twelve-labs-audio-descriptions");
      const raw = await edge.audioDescriptions(variant.videoUrl);
      const doc = buildAdDoc(raw);
      const url = await storage.upload("ad.json", utf8(JSON.stringify(doc)), "application/json");
      state.audioDescriptionUrl = url;
      state.spentUsd += cost;
      log(`uploaded ad.json -> ${url}`);
      return { assetId: url };
    }

    case "dubbing": {
      if (!state.transcript) throw new Error("dubbing: transcript not produced yet");
      const targets = variant.languages.filter((l) => l !== baseLang);
      if (targets.length === 0) return { assetId: "dub:none" }; // base language only, nothing to dub
      state.dubAudioUrls ??= {};
      let producedAny = false;
      for (const lang of targets) {
        if (state.dubAudioUrls[lang]) continue; // resume: already produced
        log(`generate-dubbing -> ${lang}`);
        const j = await edge.dub(state.transcript.text, lang);
        if (!j.audioBase64) {
          log(`${lang}: no audio returned`);
          continue;
        }
        const bytes = fromBase64(j.audioBase64);
        const url = await storage.upload(`${lang}_dub.m4a`, bytes, "audio/mp4");
        state.dubAudioUrls[lang] = url;
        producedAny = true;
        log(`${lang}: ${Math.round(bytes.length / 1024)}kb -> ${url}`);
      }
      if (producedAny) state.spentUsd += cost;
      const keys = Object.keys(state.dubAudioUrls);
      if (keys.length === 0) return {}; // no dub produced yet; stays running
      return { assetId: `dub:${keys.join(",")}` };
    }

    case "poster": {
      if (state.posterUrl) return { assetId: state.posterUrl };
      log("stability-ai poster");
      const bytes = await edge.poster("cinematic vertical poster, dramatic light, no text");
      if (!bytes || bytes.length === 0) throw new Error("poster: empty image bytes");
      const url = await storage.upload("poster.jpg", bytes, "image/jpeg");
      state.posterUrl = url;
      await content.setSeriesPoster(variant.seriesId, url);
      state.spentUsd += cost;
      log(`uploaded poster -> ${url}`);
      return { assetId: url };
    }

    case "register": {
      // Self-healing track attach: PATCH the produced track URLs onto the variant via the content service.
      const patch: VariantTrackPatch = {};
      if (state.captionDocUrl) patch.caption_doc_url = state.captionDocUrl;
      if (state.audioDescriptionUrl) patch.audio_description_url = state.audioDescriptionUrl;
      if (state.dubAudioUrls && Object.keys(state.dubAudioUrls).length > 0) patch.dub_audio_urls = state.dubAudioUrls;
      if (Object.keys(patch).length === 0) return {}; // nothing to register yet; stays running
      await content.patchTracks(variant.variantId, patch);
      log(`registered tracks: ${Object.keys(patch).join(", ")}`);
      return { assetId: `registered:${Object.keys(patch).join(",")}` };
    }

    case "publish": {
      // Go-live bookkeeping is a content/decision concern outside this executor's scope; mark complete so the
      // DAG can finish once the produced tracks are registered. No fabricated asset for a cost-bearing stage.
      return { assetId: "published" };
    }

    default:
      return {};
  }
}

// Build a StageExecutor (the jobsStore state-machine port) bound to a produce run. The state machine calls
// this only when a stage is in "running"; it advances to "done" on a returned assetId, fails on a thrown
// error, and stays running on an empty outcome (the cost-gate / not-yet-produced path). Because runStage is
// async but the StageExecutor signature is sync (the state machine ticks one step), the real driver is the
// async sweep below; this sync wrapper is for the in-process synchronous state-machine tests/preview only and
// reflects already-resolved state.
export function makeRealExecutor(deps: ProduceDeps): (stage: JobStage, job: ProduceJob) => Promise<StageOutcome> {
  return (stage) => runStage(stage, deps);
}

// Drive a produce job to completion (or a clean stop) over the REAL stages: a single async sweep that, for
// each stage in DAG order, ticks pending->running then runs the real stage. Resumable: a stage already done
// is skipped; a stage that yields no asset (cost gate / nothing produced) leaves the job running so a later
// invocation resumes it. A thrown stage fails the job. Mirrors orchestrator.runJob discipline but over the
// JOB API CONTRACT job shape so POST /produce can enqueue a REAL run. No em dashes.
export async function runProduceJob(job: ProduceJob, deps: ProduceDeps): Promise<ProduceJob> {
  for (const stage of job.stages) {
    if (stage.status === "done" || stage.status === "skipped") continue;
    if (stage.status === "failed") return job; // a prior failure stops the run (retry resets it to pending)
    stage.status = "running";
    job.state = "running";
    try {
      const outcome = await runStage(stage, deps);
      if (outcome.failed) {
        stage.status = "failed";
        job.state = "failed";
        return job;
      }
      if (outcome.assetId != null && outcome.assetId.length > 0) {
        stage.assetId = outcome.assetId;
        stage.status = "done";
      } else {
        // no real asset (cost gate or nothing produced): stop the sweep, leave the stage running to resume.
        job.state = "running";
        return job;
      }
    } catch (e) {
      stage.status = "failed";
      job.state = "failed";
      deps.onLog?.(stage.name, `failed: ${e instanceof Error ? e.message : String(e)}`);
      return job;
    }
  }
  job.state = job.stages.some((s) => s.status === "failed") ? "failed" : "done";
  return job;
}
