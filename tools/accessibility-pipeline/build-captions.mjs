// Modern captions-with-intention pipeline, fully LOCAL (no external creds):
//   1. Whisper (open SOTA ASR) gives the word-level transcript + timings  [run separately]
//   2. signal processing on the PCM gives per-word LOUDNESS (-> 7-level intensity) and PITCH (-> width)
//   3. character attribution (an LLM reading the script; here a reviewed map) assigns speaker + CI color
// Emits the CaptionSegment[] document the player's CaptionsWithIntention renderer consumes (0009a).
// No em dashes.

import { readFileSync, writeFileSync } from "node:fs";

const whisperJson = process.argv[2];
const wavPath = process.argv[3];
const outPath = process.argv[4];

// ---- character attribution (the "identify characters" step) ----
// CI palette colors per character of this fruit-noir cold open.
const COLORS = { Strawberry: "#E51717", Banana: "#E5E517", Grape: "#8C6BED", Apple: "#17E517" };
// Segment index -> speaker, attributed from the dialogue/context.
const SPK = [
  "Banana", "Strawberry", "Strawberry", "Strawberry", "Banana", "Grape", "Strawberry", "Strawberry",
  "Strawberry", "Strawberry", "Banana", "Banana", "Strawberry", "Strawberry", "Strawberry", "Strawberry",
  "Strawberry", "Strawberry", "Strawberry", "Strawberry", "Strawberry", "Strawberry", "Banana", "Banana",
  "Strawberry", "Strawberry", "Strawberry", "Banana", "Banana", "Strawberry", "Grape", "Grape",
  "Grape", "Banana", "Banana", "Strawberry", "Strawberry", "Apple", "Apple", "Apple", "Apple", "Apple",
  "Apple", "Strawberry",
];

// ---- read 16k mono 16-bit PCM wav ----
const buf = readFileSync(wavPath);
// find 'data' chunk
let p = 12;
let dataOff = 44, dataLen = buf.length - 44, sampleRate = 16000;
while (p + 8 <= buf.length) {
  const id = buf.toString("ascii", p, p + 4);
  const sz = buf.readUInt32LE(p + 4);
  if (id === "fmt ") sampleRate = buf.readUInt32LE(p + 12);
  if (id === "data") { dataOff = p + 8; dataLen = sz; break; }
  p += 8 + sz;
}
const N = Math.floor(dataLen / 2);
const pcm = new Int16Array(N);
for (let i = 0; i < N; i++) pcm[i] = buf.readInt16LE(dataOff + i * 2);

function rmsDb(s0, s1) {
  s0 = Math.max(0, s0 | 0); s1 = Math.min(N, s1 | 0);
  if (s1 <= s0) return -90;
  let sum = 0;
  for (let i = s0; i < s1; i++) { const v = pcm[i] / 32768; sum += v * v; }
  const rms = Math.sqrt(sum / (s1 - s0));
  return rms > 0 ? 20 * Math.log10(rms) : -90;
}
// coarse autocorrelation F0 (Hz) over a word window, for high/low/normal pitch
function pitchHz(s0, s1) {
  s0 = Math.max(0, s0 | 0); s1 = Math.min(N, s1 | 0);
  const len = s1 - s0;
  if (len < 400) return 0;
  const minLag = Math.floor(sampleRate / 350); // 350 Hz
  const maxLag = Math.floor(sampleRate / 80);  // 80 Hz
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag && lag < len; lag++) {
    let c = 0;
    for (let i = s0; i < s1 - lag; i += 2) c += (pcm[i] / 32768) * (pcm[i + lag] / 32768);
    if (c > best) { best = c; bestLag = lag; }
  }
  return bestLag ? sampleRate / bestLag : 0;
}

// ---- per-word prosody ----
const seg = JSON.parse(readFileSync(whisperJson, "utf8")).segments;
const allWords = [];
for (const s of seg) for (const w of s.words ?? []) {
  const db = rmsDb(w.start * sampleRate, w.end * sampleRate);
  const f0 = pitchHz(w.start * sampleRate, w.end * sampleRate);
  allWords.push({ w, db, f0 });
}
const dbs = allWords.map((x) => x.db).filter((d) => d > -80).sort((a, b) => a - b);
const mean = dbs.reduce((a, b) => a + b, 0) / dbs.length;
const std = Math.sqrt(dbs.reduce((a, b) => a + (b - mean) ** 2, 0) / dbs.length) || 1;
const f0s = allWords.map((x) => x.f0).filter((f) => f > 0).sort((a, b) => a - b);
const f0med = f0s[Math.floor(f0s.length / 2)] || 150;

function intensity(db, text) {
  const allCaps = /[A-Z]{2,}/.test(text.replace(/[^A-Za-z]/g, ""));
  const z = (db - mean) / std;
  if (allCaps && z > 0.4) return "screaming";
  if (z < -1.3) return "whisper";
  if (z < -0.6) return "quiet";
  if (z < 0.55) return "normal";
  if (z < 1.15) return "loud";
  if (z < 1.75) return "yelling";
  return "screaming";
}
function pitchLabel(f0) {
  if (!f0) return "normal";
  if (f0 > f0med * 1.15) return "high";
  if (f0 < f0med * 0.85) return "low";
  return "normal";
}

// ---- build CaptionSegment[] ----
const segments = seg.map((s, i) => {
  const speaker = SPK[i] ?? "Strawberry";
  const words = (s.words ?? []).map((w) => {
    const db = rmsDb(w.start * sampleRate, w.end * sampleRate);
    const f0 = pitchHz(w.start * sampleRate, w.end * sampleRate);
    const text = w.word.trim();
    const it = intensity(db, text);
    return {
      text,
      startTime: +w.start.toFixed(3),
      endTime: +w.end.toFixed(3),
      intensity: it,
      emphasis: it,
      pitch: pitchLabel(f0),
    };
  });
  return {
    text: s.text.trim(),
    speaker,
    speakerColor: COLORS[speaker] ?? "#22E3D0",
    startTime: +s.start.toFixed(3),
    endTime: +s.end.toFixed(3),
    words,
  };
});

writeFileSync(outPath, JSON.stringify({ segments }, null, 2));
const counts = {};
for (const w of allWords) { const it = intensity(w.db, w.w.word); counts[it] = (counts[it] || 0) + 1; }
console.log(`wrote ${segments.length} segments, ${allWords.length} words to ${outPath}`);
console.log("characters:", [...new Set(SPK)].join(", "));
console.log("intensity distribution:", JSON.stringify(counts));
