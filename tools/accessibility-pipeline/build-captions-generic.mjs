// GENERIC captions-with-intention builder for ANY video (no hardcoded speakers/emotion/intent). Local, no
// creds: Whisper gives word-level timings, signal processing on the PCM gives per-word loudness (-> 7-level
// intensity), pitch (-> weight axis), and harmonic ratio (-> width axis). Emits the CaptionSegment[] document
// the player's CaptionsWithIntention renderer consumes. Speaker attribution + emotion/intent are LEFT OPEN
// here (a single neutral speaker, neutral color); the OpenAI semantic pass (auto-produce stage) fills
// speakerColor/emotion/intent per segment when wired. The three Roboto Flex axis signals (energy_rms, f0_hz,
// harmonic_ratio) are always real and per-word. Usage: node build-captions-generic.mjs <whisper.json>
// <audio.wav> <out.json> [speakerName]. No em dashes.

import { readFileSync, writeFileSync } from "node:fs";

const whisperJson = process.argv[2];
const wavPath = process.argv[3];
const outPath = process.argv[4];
const speaker = process.argv[5] || "Speaker";
const NEUTRAL = "#22E3D0"; // brand-neutral caption color until the LLM assigns a per-character CI color

// ---- read 16k mono 16-bit PCM wav ----
const buf = readFileSync(wavPath);
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
function rmsLinear(s0, s1) {
  s0 = Math.max(0, s0 | 0); s1 = Math.min(N, s1 | 0);
  if (s1 <= s0) return 0;
  let sum = 0;
  for (let i = s0; i < s1; i++) { const v = pcm[i] / 32768; sum += v * v; }
  return Math.sqrt(sum / (s1 - s0));
}
function harmonicRatio(s0, s1) {
  s0 = Math.max(0, s0 | 0); s1 = Math.min(N, s1 | 0);
  if (s1 <= s0) return 0.5;
  const fc = 1500, dt = 1 / sampleRate, rc = 1 / (2 * Math.PI * fc), a = dt / (rc + dt);
  let lp = 0, low = 0, high = 0, n = 0;
  for (let i = s0; i < s1; i++) { const x = pcm[i] / 32768; lp = lp + a * (x - lp); const hp = x - lp; low += lp * lp; high += hp * hp; n++; }
  const lr = Math.sqrt(low / n), hr = Math.sqrt(high / n);
  return lr + hr > 0 ? lr / (lr + hr) : 0.5;
}
function pitchHz(s0, s1) {
  s0 = Math.max(0, s0 | 0); s1 = Math.min(N, s1 | 0);
  const len = s1 - s0;
  if (len < 400) return 0;
  const minLag = Math.floor(sampleRate / 350);
  const maxLag = Math.floor(sampleRate / 80);
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag && lag < len; lag++) {
    let c = 0;
    for (let i = s0; i < s1 - lag; i += 2) c += (pcm[i] / 32768) * (pcm[i + lag] / 32768);
    if (c > best) { best = c; bestLag = lag; }
  }
  return bestLag ? sampleRate / bestLag : 0;
}
function medianF0(s0, s1) {
  s0 = Math.max(0, s0 | 0); s1 = Math.min(N, s1 | 0);
  const len = s1 - s0;
  if (len < 800) return pitchHz(s0, s1);
  const k = Math.min(4, Math.floor(len / 600));
  const vals = [];
  for (let j = 0; j < k; j++) {
    const a = s0 + Math.floor((len * j) / k);
    const b = s0 + Math.floor((len * (j + 1)) / k);
    const f = pitchHz(a, b);
    if (f > 0) vals.push(f);
  }
  if (!vals.length) return pitchHz(s0, s1);
  vals.sort((a, b) => a - b);
  return Math.round(vals[Math.floor(vals.length / 2)]);
}

const seg = JSON.parse(readFileSync(whisperJson, "utf8")).segments ?? [];
// loudness stats over all words for the z-scored intensity classifier
const dbsAll = [];
for (const s of seg) for (const w of s.words ?? []) {
  const d = rmsDb((w.start ?? 0) * sampleRate, (w.end ?? 0) * sampleRate);
  if (d > -80) dbsAll.push(d);
}
dbsAll.sort((a, b) => a - b);
const mean = dbsAll.length ? dbsAll.reduce((a, b) => a + b, 0) / dbsAll.length : -40;
const std = dbsAll.length ? Math.sqrt(dbsAll.reduce((a, b) => a + (b - mean) ** 2, 0) / dbsAll.length) || 1 : 1;
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

const segments = seg.map((s) => {
  const words = (s.words ?? []).map((w) => {
    const s0 = (w.start ?? 0) * sampleRate, s1 = (w.end ?? 0) * sampleRate;
    const db = rmsDb(s0, s1);
    const text = String(w.word ?? w.text ?? "").trim();
    return {
      text,
      start_ms: Math.round((w.start ?? 0) * 1000),
      end_ms: Math.round((w.end ?? 0) * 1000),
      startTime: +(w.start ?? 0).toFixed(3),
      endTime: +(w.end ?? 0).toFixed(3),
      character_id: speaker,
      f0_hz: Math.round(medianF0(s0, s1)),
      energy_rms: +rmsLinear(s0, s1).toFixed(4),
      harmonic_ratio: +harmonicRatio(s0, s1).toFixed(3),
      intensity: intensity(db, text),
    };
  });
  return {
    text: String(s.text ?? "").trim(),
    speaker,
    speakerColor: NEUTRAL,
    character_id: speaker,
    startTime: +(s.start ?? 0).toFixed(3),
    endTime: +(s.end ?? 0).toFixed(3),
    words,
  };
});

const energies = segments.flatMap((s) => s.words.map((w) => w.energy_rms)).filter((e) => e > 0).sort((a, b) => a - b);
const f0all = segments.flatMap((s) => s.words.map((w) => w.f0_hz)).filter((f) => f > 0).sort((a, b) => a - b);
const pct = (arr, q) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * q))] : 0);
const meta = {
  font: "Roboto Flex",
  energy: { p10: pct(energies, 0.1), p50: pct(energies, 0.5), p90: pct(energies, 0.9), max: energies.at(-1) ?? 0 },
  f0: { p10: pct(f0all, 0.1), p50: pct(f0all, 0.5), p90: pct(f0all, 0.9) },
};

writeFileSync(outPath, JSON.stringify({ version: 2, meta, segments }, null, 2));
console.log(`wrote ${segments.length} segments, ${segments.reduce((n, s) => n + s.words.length, 0)} words to ${outPath}`);
