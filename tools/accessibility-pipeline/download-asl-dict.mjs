// Extract a real per-word ASL video dictionary from open sources (WLASL gloss index -> direct-download hosts).
// For every content word in the cut's transcript, try EVERY candidate URL on a reachable host until one yields
// a real, encodable video; trim to the WLASL frame range; encode a uniform vertical clip. Robust: each word is
// fully isolated, already-downloaded words are skipped, and the manifest is rebuilt from what is on disk so a
// mid-run failure never loses progress. Licensing of source clips is handled separately. No em dashes.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { join } from "node:path";

const wlaslJson = process.argv[2];
const whisperJson = process.argv[3];
const outDir = process.argv[4];
const tmp = "/tmp/asldl";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const HOSTS = ["signstock.blob", "files.startasl.com", "aslbricks.org"];

if (!existsSync(tmp)) mkdirSync(tmp, { recursive: true });
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const wlasl = JSON.parse(readFileSync(wlaslJson, "utf8"));
const gloss = new Map(wlasl.map((g) => [g.gloss.toLowerCase(), g.instances]));
const lemma = (w) => w.toLowerCase().replace(/[^a-z]/g, "");
let targets;
if (whisperJson === "ALL") {
  targets = [...gloss.keys()].filter((w) => /^[a-z]+$/.test(w)); // whole WLASL vocabulary
} else {
  const seg = JSON.parse(readFileSync(whisperJson, "utf8")).segments;
  targets = [...new Set(seg.flatMap((s) => (s.words ?? []).map((w) => lemma(w.word))))].filter((w) => w.length > 1 && gloss.has(w));
}

const probe = (f) => {
  try {
    const out = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=codec_type:format=duration -of csv=p=0 "${f}" 2>/dev/null`).toString();
    const dur = parseFloat(out.split(/\s+/).filter(Boolean).pop());
    return out.includes("video") && dur > 0.25 && dur < 30 ? dur : 0;
  } catch { return 0; }
};

const YT = process.env.ENABLE_YTDLP === "1"; // best-effort YouTube fallback (often 403s without cookies)
const encode = (raw, out, inst) => {
  const trim = [];
  if (inst?.frame_end && inst.frame_end > 0) {
    const fps = inst.fps || 25;
    trim.push("-ss", Math.max(0, (inst.frame_start - 1) / fps).toFixed(2), "-to", (inst.frame_end / fps).toFixed(2));
  }
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-y", ...trim, "-i", raw, "-an",
      "-vf", "scale=480:640:force_original_aspect_ratio=increase,crop=480:640,fps=24,setsar=1",
      "-c:v", "libvpx-vp9", "-b:v", "600k", "-deadline", "good", "-cpu-used", "3", out],
      { stdio: "ignore", timeout: 90000, killSignal: "SIGKILL" });
  } catch { return false; }
  return !!probe(out);
};

const tryWord = (word) => {
  const out = join(outDir, `asl-${word}.webm`);
  if (existsSync(out) && probe(out)) return "skip";
  const raw = join(tmp, `${word}.src`);
  // 1) direct-download hosts, by priority
  const cands = [];
  for (const h of HOSTS) for (const i of gloss.get(word) ?? []) if (i.url.includes(h)) cands.push(i);
  for (const inst of cands) {
    try { execFileSync("curl", ["-sL", "--max-time", "40", "-A", UA, "-e", "https://www.google.com/", "-o", raw, inst.url], { stdio: "ignore", timeout: 50000 }); } catch { continue; }
    if (!probe(raw)) { rmSync(raw, { force: true }); continue; }
    if (encode(raw, out, inst)) { rmSync(raw, { force: true }); return "ok"; }
    rmSync(raw, { force: true }); rmSync(out, { force: true });
  }
  // 2) optional YouTube fallback via yt-dlp (best-effort)
  if (YT) {
    for (const inst of (gloss.get(word) ?? []).filter((i) => /youtu/.test(i.url)).slice(0, 2)) {
      try { execFileSync("python3", ["-m", "yt_dlp", "--no-warnings", "-q", "--extractor-args", "youtube:player_client=android", "-f", "mp4/best", "-o", raw, inst.url], { stdio: "ignore", timeout: 120000, killSignal: "SIGKILL" }); } catch { continue; }
      if (!probe(raw)) { rmSync(raw, { force: true }); continue; }
      if (encode(raw, out, inst)) { rmSync(raw, { force: true }); return "ok"; }
      rmSync(raw, { force: true }); rmSync(out, { force: true });
    }
  }
  return "fail";
};

let ok = 0, skip = 0, fail = 0;
for (const word of targets) {
  let r = "fail";
  try { r = tryWord(word); } catch { r = "fail"; }
  if (r === "ok") ok++; else if (r === "skip") skip++; else fail++;
  if ((ok + skip + fail) % 15 === 0) console.log(`  progress ${ok + skip + fail}/${targets.length} (ok ${ok}, kept ${skip}, fail ${fail})`);
}

// rebuild manifest from disk
const onDisk = readdirSync(outDir).filter((f) => /^asl-.+\.webm$/.test(f)).map((f) => f.replace(/^asl-|\.webm$/g, ""));
writeFileSync(join(outDir, "dictionary.json"), JSON.stringify({ source: "WLASL v0.3 gloss index, direct-download hosts (signstock/startasl/aslbricks)", note: "licensing handled separately by operator", count: onDisk.length, words: onDisk.sort() }, null, 2));
console.log(`DONE: ${onDisk.length} real ASL word clips on disk (this run: ok ${ok}, kept ${skip}, fail ${fail}) of ${targets.length} targets`);
console.log("words:", onDisk.sort().join(" "));
