// Recover V-Librasil gloss labels by scraping the archived UFPE lexicon (libras.cin.ufpe.br).
// The S3 video zips are timestamp+hash filenames with no gloss. Each archived /sign/<ID> page
// carries the Portuguese gloss (page title) and, per articulator section, the video whose URL
// filename is the SAME timestamp+hash that is in the S3 zip. So we parse (gloss, articulator -> filename)
// and later join filename -> gloss against the extracted videos. Live site is 502, so we use Wayback.
// Input: a CDX list "timestamp original statuscode" of archived /sign/ snapshots. No em dashes.

import { readFileSync, writeFileSync } from "node:fs";

const CDX = process.argv[2] || "/tmp/cdx_sign_ts.txt";
const OUT = process.argv[3] || "vlibrasil_recovered.csv";
const CONCURRENCY = 5;
const RETRIES = 4;

const rows = readFileSync(CDX, "utf8").trim().split("\n").map((l) => l.trim().split(/\s+/))
  .filter((c) => c.length >= 2 && /\/sign\/\d+/.test(c[1]))
  .map(([ts, url]) => ({ ts, url, id: (url.match(/\/sign\/(\d+)/) || [])[1] }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pull the gloss from the page title "X - Details - V-LIBRASIL" (fallback first <h1>).
function parseGloss(html) {
  let m = html.match(/<title>\s*(.*?)\s*-\s*Details\s*-\s*V-?LIBRASIL/i);
  if (m) return decode(m[1].trim());
  m = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
  return m ? decode(m[1].replace(/<[^>]+>/g, "").trim()) : "";
}

// Associate each /storage/videos/<file>.mp4 with its "Articulador N" section.
// We walk the page, tracking the most recent "Articulador N" header before each video tag.
function parseArticulatorVideos(html) {
  const out = {}; // articulator number -> filename
  const re = /Articulador\s*([123])|\/storage\/videos\/([0-9]{8,}_[a-z0-9]+\.mp4)/gi;
  let cur = null, m;
  while ((m = re.exec(html))) {
    if (m[1]) cur = m[1];
    else if (m[2] && cur && !out[cur]) out[cur] = m[2];
  }
  return out;
}

function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&aacute;/g, "a")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

async function fetchSnapshot(r) {
  const wb = `http://web.archive.org/web/${r.ts}id_/${r.url}`;
  for (let a = 0; a < RETRIES; a++) {
    try {
      const res = await fetch(wb, { redirect: "follow" });
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (a + 1)); continue; }
      if (!res.ok) return null;
      return await res.text();
    } catch { await sleep(1500 * (a + 1)); }
  }
  return null;
}

const records = [];
let done = 0, fail = 0;
async function worker(queue) {
  while (queue.length) {
    const r = queue.shift();
    const html = await fetchSnapshot(r);
    if (!html) { fail++; done++; continue; }
    const gloss = parseGloss(html);
    const vids = parseArticulatorVideos(html);
    for (const [artic, file] of Object.entries(vids)) {
      records.push({ sign_id: r.id, gloss, articulator: artic, source_file: file, snapshot: r.ts });
    }
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${rows.length} pages, ${records.length} videos, ${fail} fails`);
    await sleep(120);
  }
}

console.log(`Crawling ${rows.length} archived /sign/ pages, concurrency ${CONCURRENCY}...`);
const queue = rows.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
const csv = ["sign_id,gloss,articulator,source_file,snapshot",
  ...records.map((r) => [r.sign_id, esc(r.gloss), r.articulator, r.source_file, r.snapshot].join(","))].join("\n");
writeFileSync(OUT, csv + "\n");
writeFileSync(OUT.replace(/\.csv$/, ".json"), JSON.stringify(records, null, 2));
console.log(`DONE: ${done} pages crawled, ${fail} fails, ${records.length} (gloss,articulator,file) rows -> ${OUT}`);
