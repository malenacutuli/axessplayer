// Build a real, dialogue-aligned ASL sign track from the extracted per-word dictionary (download-asl-dict.mjs).
// Pipeline: dialogue (Whisper words) -> text-to-gloss (lemmatize, keep content words that have a real clip) ->
// concatenate the matched real sign clips in dialogue order with a short neutral hold between each -> one sign
// track that loops in the vertical PiP, plus a gloss manifest mapping each clip back to the spoken word so
// coverage is auditable. Every clip is a real ASL sign, not a placeholder. No em dashes.

import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const whisperJson = process.argv[2];
const dictDir = process.argv[3]; // real per-word dictionary (asl-<word>.webm)
const mediaDir = process.argv[4]; // output media dir
const tmp = "/tmp/sign";

const lemma = (w) => w.toLowerCase().replace(/[^a-z]/g, "");
const clipFor = (w) => {
  // absolute path: ffmpeg's concat demuxer resolves list entries relative to the list file, not cwd.
  const p = resolve(dictDir, `asl-${w}.webm`);
  return existsSync(p) ? p : null;
};

const seg = JSON.parse(readFileSync(whisperJson, "utf8")).segments;

// 1) text-to-gloss: each content word that has a real clip becomes a sign event at its word time.
const events = [];
const gloss = [];
for (const s of seg) {
  for (const w of s.words ?? []) {
    const l = lemma(w.word);
    if (l.length < 2) continue;
    if (clipFor(l)) {
      events.push({ start: w.start, word: l });
      gloss.push({ word: w.word.trim(), sign: l.toUpperCase(), startTime: +w.start.toFixed(2) });
    }
  }
}
// drop immediate duplicates of the same sign within 0.6s (e.g. "no, no, no").
const dedup = [];
for (const e of events) {
  const prev = dedup[dedup.length - 1];
  if (prev && prev.word === e.word && e.start - prev.start < 0.6) continue;
  dedup.push(e);
}

if (!existsSync(tmp)) mkdirSync(tmp, { recursive: true });

// one short neutral hold reused between signs (a still frame from a dictionary clip), generated once.
const sampleClip = clipFor(dedup[0]?.word) || clipFor(lemma(seg[0].words?.[0]?.word || ""));
const neutralPng = join(tmp, "neutral.png");
execFileSync("ffmpeg", ["-hide_banner", "-y", "-i", sampleClip, "-frames:v", "1", neutralPng], { stdio: "ignore" });
const holdClip = join(tmp, "hold.webm");
execFileSync("ffmpeg", ["-hide_banner", "-y", "-loop", "1", "-t", "0.3", "-i", neutralPng, "-an",
  "-vf", "scale=480:640,fps=24,setsar=1", "-c:v", "libvpx-vp9", "-b:v", "600k", "-deadline", "good", "-cpu-used", "3", holdClip], { stdio: "ignore" });

// 2) assemble: matched real signs in dialogue order, a short hold between each. Loops in the PiP.
const list = [holdClip];
for (const e of dedup) list.push(clipFor(e.word), holdClip);

const listFile = join(tmp, "list.txt");
writeFileSync(listFile, list.map((p) => `file '${p}'`).join("\n"));
execFileSync("ffmpeg", ["-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", listFile,
  "-c:v", "libvpx-vp9", "-b:v", "600k", "-deadline", "good", "-cpu-used", "3", join(mediaDir, "asl_sign.webm")], { stdio: "ignore" });
writeFileSync(join(mediaDir, "asl_gloss.json"), JSON.stringify({
  language: "ASL",
  method: "text-to-gloss over a real extracted per-word ASL dictionary (WLASL sources), concatenative",
  signCount: dedup.length,
  gloss,
}, null, 2));

const totalDur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(mediaDir, "asl_sign.webm")]).toString().trim());
console.log(`asl_sign.webm: ${totalDur.toFixed(1)}s, ${dedup.length} real signs from ${gloss.length} matched dialogue words`);
console.log("signs:", dedup.map((e) => e.word.toUpperCase()).join(" "));
rmSync(tmp, { recursive: true, force: true });
