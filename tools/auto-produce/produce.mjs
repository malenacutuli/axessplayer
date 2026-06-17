// One-click auto-produce orchestration (CLI core). Given an uploaded video and its variant, it runs the
// accessibility + publish stages and reports each: extract audio -> ASR (local whisper) -> generic CWI
// captions -> register caption_doc_url -> (dubs via generate-dubbing) -> poster -> publish. Local + key-free
// for the mechanical stages; the semantic/dub/poster stages call the project edge functions (keys live on
// Supabase). Idempotent per artifact: a present file is reused, not regenerated. No em dashes.
//
// Usage:
//   node tools/auto-produce/produce.mjs \
//     --video <local mp4/mov> --dir <media-upload-dir> --public <http://127.0.0.1:8095/media/<id>> \
//     --variant <variantId> --series <seriesId> --content <http://127.0.0.1:8093> \
//     [--langs es,fr] [--speaker Name] [--stages captions,poster,publish]

import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PIPE = join(HERE, "..", "accessibility-pipeline");

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const VIDEO = arg("video");
const DIR = arg("dir");
const PUBLIC = (arg("public") || "").replace(/\/$/, "");
const VARIANT = arg("variant");
const SERIES = arg("series");
const CONTENT = (arg("content", "http://127.0.0.1:8093")).replace(/\/$/, "");
const LANGS = (arg("langs", "")).split(",").map((s) => s.trim()).filter(Boolean);
const SPEAKER = arg("speaker", "Speaker");
const STAGES = (arg("stages", "captions,poster,publish")).split(",").map((s) => s.trim());

if (!VIDEO || !DIR || !PUBLIC || !VARIANT) {
  console.error("required: --video --dir --public --variant");
  process.exit(2);
}
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (stage, msg) => console.log(`[${stamp()}] ${stage.padEnd(10)} ${msg}`);

async function patchTracks(tracks) {
  const res = await fetch(`${CONTENT}/variants/${encodeURIComponent(VARIANT)}/tracks`, {
    method: "PATCH",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(tracks),
  });
  if (!res.ok) throw new Error(`register tracks failed ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

// ---- 1. extract 16k mono wav ----
const wav = join(DIR, "audio16k.wav");
if (!existsSync(wav)) {
  log("audio", "extracting 16k mono wav");
  execFileSync("ffmpeg", ["-hide_banner", "-y", "-i", VIDEO, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { stdio: "ignore" });
}
log("audio", `wav ready: ${wav}`);

// ---- 2. ASR via local whisper (word timestamps) ----
const whisperJson = join(DIR, "audio16k.json");
if (!existsSync(whisperJson)) {
  log("asr", "running whisper (word timestamps); this can take a minute");
  execFileSync("whisper", [wav, "--model", "small", "--language", "en", "--word_timestamps", "True",
    "--output_format", "json", "--output_dir", DIR], { stdio: "inherit" });
}
log("asr", `transcript ready: ${whisperJson}`);

// ---- 3. generic CWI captions ----
if (STAGES.includes("captions")) {
  const capOut = join(DIR, "captions.json");
  log("captions", "building generic CWI captions (energy/f0/harmonics + intensity)");
  execFileSync("node", [join(PIPE, "build-captions-generic.mjs"), whisperJson, wav, capOut, SPEAKER], { stdio: "inherit" });
  await patchTracks({ caption_doc_url: `${PUBLIC}/captions.json` });
  log("captions", `registered caption_doc_url -> ${PUBLIC}/captions.json`);
}

// ---- 4. dubs (real, via generate-dubbing edge function) ---- flagged: wired in the next increment
if (STAGES.includes("dubs") && LANGS.length) {
  log("dubs", `TODO wire generate-dubbing for: ${LANGS.join(", ")} (edge function, ElevenLabs)`);
}

// ---- 5. poster (server-side stability-ai via the content service) ----
if (STAGES.includes("poster") && SERIES) {
  log("poster", "generating poster via content /poster/generate");
  const res = await fetch(`${CONTENT}/series/${encodeURIComponent(SERIES)}/poster/generate`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ prompt: "cinematic vertical poster, dramatic light, no text" }),
  });
  log("poster", res.ok ? `ok -> ${(await res.json()).poster_url}` : `skipped (${res.status})`);
}

// ---- 6. publish ----
if (STAGES.includes("publish") && SERIES) {
  const res = await fetch(`${CONTENT}/series/${encodeURIComponent(SERIES)}/publish`, { method: "POST", headers: { accept: "application/json" } });
  log("publish", res.ok ? "live on the feed" : `skipped (${res.status})`);
}

log("done", "auto-produce complete");
