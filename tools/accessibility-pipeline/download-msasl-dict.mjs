// Extract an ASL dictionary from the MS-ASL (Microsoft) annotations: YouTube-hosted clips with per-sample word
// labels and start/end times. Uses yt-dlp (player_client=android bypasses YouTube's 403). One clip per word,
// trimmed to the annotated span, normalized to the uniform vertical format. This enriches the ASL vocabulary
// beyond WLASL (alternate signers, words WLASL misses). Licensing handled separately. No em dashes.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { join } from "node:path";

const msaslJson = process.argv[2]; // an MSASL_*.json split
const outDir = process.argv[3];
const tmp = "/tmp/msasldl";

if (!existsSync(tmp)) mkdirSync(tmp, { recursive: true });
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const samples = JSON.parse(readFileSync(msaslJson, "utf8"));
// first sample per word (clean_text)
const byWord = new Map();
for (const s of samples) {
  const w = (s.clean_text || s.text || "").toLowerCase().replace(/[^a-z]/g, "");
  if (w.length > 1 && /youtu/.test(s.url) && !byWord.has(w)) byWord.set(w, s);
}
const targets = [...byWord.keys()];

const probe = (f) => {
  try {
    const out = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=codec_type:format=duration -of csv=p=0 "${f}" 2>/dev/null`, { timeout: 25000 }).toString();
    const dur = parseFloat(out.split(/\s+/).filter(Boolean).pop());
    return out.includes("video") && dur > 0.25 && dur < 30 ? dur : 0;
  } catch { return 0; }
};

const tryWord = (word) => {
  const out = join(outDir, `asl-${word}.webm`);
  if (existsSync(out) && probe(out)) return "skip";
  const s = byWord.get(word);
  const url = s.url.startsWith("http") ? s.url : `https://${s.url}`;
  const raw = join(tmp, `${word}.mp4`);
  try {
    execFileSync("python3", ["-m", "yt_dlp", "--no-warnings", "-q", "--extractor-args", "youtube:player_client=android",
      "-f", "mp4/best", "-o", raw, url], { stdio: "ignore", timeout: 120000, killSignal: "SIGKILL" });
  } catch { return "fail"; }
  if (!probe(raw)) { rmSync(raw, { force: true }); return "fail"; }
  const trim = [];
  if (s.end_time && s.end_time > s.start_time) trim.push("-ss", String(s.start_time), "-to", String(s.end_time));
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-y", ...trim, "-i", raw, "-an",
      "-vf", "scale=480:640:force_original_aspect_ratio=increase,crop=480:640,fps=24,setsar=1",
      "-c:v", "libvpx-vp9", "-b:v", "600k", "-deadline", "good", "-cpu-used", "3", out],
      { stdio: "ignore", timeout: 90000, killSignal: "SIGKILL" });
  } catch { rmSync(raw, { force: true }); rmSync(out, { force: true }); return "fail"; }
  rmSync(raw, { force: true });
  return probe(out) ? "ok" : "fail";
};

let ok = 0, skip = 0, fail = 0;
for (const word of targets) {
  let r = "fail";
  try { r = tryWord(word); } catch { r = "fail"; }
  if (r === "ok") ok++; else if (r === "skip") skip++; else fail++;
  if ((ok + skip + fail) % 20 === 0) console.log(`  progress ${ok + skip + fail}/${targets.length} (ok ${ok}, kept ${skip}, fail ${fail})`);
}
const onDisk = readdirSync(outDir).filter((f) => /^asl-.+\.webm$/.test(f)).map((f) => f.replace(/^asl-|\.webm$/g, "")).sort();
writeFileSync(join(outDir, "dictionary.json"), JSON.stringify({ source: "MS-ASL (Microsoft) annotations, YouTube via yt-dlp android client", note: "licensing handled separately by operator", count: onDisk.length, words: onDisk }, null, 2));
console.log(`DONE: ${onDisk.length} MS-ASL clips on disk (this run: ok ${ok}, kept ${skip}, fail ${fail}) of ${targets.length} targets`);
