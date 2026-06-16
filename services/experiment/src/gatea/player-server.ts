// Prompt 01 / T6: the minimal instrumented test player + its serving harness. Self-contained and
// isolated from the production services/contracts. It reads the hero spine from the hosted mobile
// schema, assigns Control vs Treatment, selects the variant per beat (Control = showrunner; Treatment =
// epsilon-greedy), LOGS every impression with its propensity to mobile.decision_log, and serves a
// two-video seamless-switch player. No accessibility, wallet, recommender, or branching UI. No em dashes.
//
// Run: set -a && source infra/hosted/.env.hosted && set +a
//      pnpm --filter @axessplayer/experiment exec node --import tsx src/gatea/player-server.ts
// Then open http://127.0.0.1:8097/?arm=treatment (or arm=control).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import pg from "pg";
import { assignArm } from "./arm.js";
import { selectTreatment, controlImpression, seededRng, type Variant } from "./policy.js";

const HERO_SERIES = "2a000000-0000-0000-0000-000000000001";
const EPSILON = 0.2;
// Demo viewer per arm (seeded in mobile.users) so the decision_log FK holds. Real deploy uses the
// authenticated viewer id.
const ARM_VIEWER: Record<string, string> = {
  control: "2a000000-0000-0000-0000-0000000000c0",
  treatment: "2a000000-0000-0000-0000-0000000000d0",
};

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ...(process.env.DB_OPTIONS ? { options: process.env.DB_OPTIONS } : {}),
});

type BeatRow = { beat_id: string; beat_index: number; variant_id: string; playback_url: string; tier: string; pov: string | null };

async function loadSpine(): Promise<{ beatId: string; controlVariantId: string; variants: Variant[]; urls: Record<string, string> }[]> {
  const { rows } = await pool.query<BeatRow>(
    `select b.id as beat_id, b.beat_index, v.id as variant_id, v.playback_url, v.tier, v.pov
       from mobile.beats b join mobile.beat_variants v on v.beat_id = b.id
      where b.series_id = $1 and v.qa_status = 'passed'
      order by b.beat_index, v.tier`,
    [HERO_SERIES],
  );
  const byBeat = new Map<string, { beatId: string; index: number; controlVariantId: string; variants: Variant[]; urls: Record<string, string> }>();
  for (const r of rows) {
    let b = byBeat.get(r.beat_id);
    if (!b) { b = { beatId: r.beat_id, index: r.beat_index, controlVariantId: "", variants: [], urls: {} }; byBeat.set(r.beat_id, b); }
    b.urls[r.variant_id] = r.playback_url;
    if (r.tier === "showrunner") b.controlVariantId = r.variant_id;
    else b.variants.unshift({ variantId: r.variant_id }); // candidate first => greedy prefers it cold-start
    if (r.tier === "showrunner") b.variants.push({ variantId: r.variant_id });
  }
  return [...byBeat.values()].sort((a, b) => a.index - b.index).map(({ beatId, controlVariantId, variants, urls }) => ({ beatId, controlVariantId, variants, urls }));
}

async function decide(arm: string, session: string, beatId: string) {
  const spine = await loadSpine();
  const beat = spine.find((b) => b.beatId === beatId);
  if (!beat) throw new Error("unknown beat");
  const equalValue: Record<string, number> = {};
  for (const v of beat.variants) equalValue[v.variantId] = 0.5; // cold start; greedy = first (candidate)
  const sel = arm === "control"
    ? controlImpression(beat.controlVariantId)
    : selectTreatment(beat.variants, equalValue, EPSILON, seededRng(`${session}:${beatId}`));
  const viewer = ARM_VIEWER[arm] ?? ARM_VIEWER.treatment;
  // THE DATA WALL: log the impression with its propensity before serving.
  const ins = await pool.query<{ id: string }>(
    `insert into mobile.decision_log (user_id, beat_id, served_variant_id, is_control, policy_version, propensity, reward)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [viewer, beatId, sel.variantId, arm === "control", sel.policyVersion, sel.propensity, JSON.stringify({ session_id: session, arm, ts: Date.now() })],
  );
  return { decisionId: ins.rows[0].id, variantId: sel.variantId, playbackUrl: beat.urls[sel.variantId], propensity: sel.propensity, arm, policyVersion: sel.policyVersion };
}

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/api/spine") {
      const spine = await loadSpine();
      return json(res, 200, { series: HERO_SERIES, beats: spine.map((b) => ({ beatId: b.beatId })) });
    }
    if (url.pathname === "/api/decide") {
      const arm = url.searchParams.get("arm") ?? "treatment";
      const session = url.searchParams.get("session") ?? "s-0";
      const beat = url.searchParams.get("beat") ?? "";
      return json(res, 200, await decide(arm, session, beat));
    }
    if (url.pathname === "/api/check") {
      const logged = await pool.query<{ n: number }>(`select count(*)::int as n from mobile.decision_log`);
      const unlogged = await pool.query<{ n: number }>(`select count(*)::int as n from mobile.decision_log where propensity is null`);
      return json(res, 200, { logged: logged.rows[0].n, unlogged: unlogged.rows[0].n });
    }
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(PLAYER_HTML);
    }
    res.writeHead(404); res.end("not found");
  } catch (e) {
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

const PORT = Number(process.env.PORT ?? 8097);
server.listen(PORT, "127.0.0.1", () => console.log(`gatea test player on http://127.0.0.1:${PORT}`));

const PLAYER_HTML = `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Gate A test player</title><style>html,body{margin:0;background:#000;height:100%}#stage{position:fixed;inset:0}
video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .12s}
video.on{opacity:1}#hud{position:fixed;left:8px;top:8px;color:#fff;font:12px ui-monospace,monospace;background:#0008;padding:6px 8px;border-radius:6px;z-index:9}</style></head>
<body><div id=stage><video id=v0 muted playsinline></video><video id=v1 muted playsinline></video></div>
<div id=hud>gate A test player</div><script>
const qs=new URLSearchParams(location.search); const arm=qs.get('arm')||'treatment'; const fast=qs.get('fast')==='1';
const session='s-'+Math.floor(performance.now())+'-'+arm; const vids=[document.getElementById('v0'),document.getElementById('v1')];
const hud=document.getElementById('hud'); window.__gatea={arm,session,played:[],done:false,seamGaps:0};
const decide=async(beat)=>(await fetch('/api/decide?arm='+arm+'&session='+session+'&beat='+beat)).json();
async function preload(v,u){return new Promise(r=>{v.src=u;v.load();const ok=()=>{v.removeEventListener('canplaythrough',ok);r()};v.addEventListener('canplaythrough',ok);setTimeout(r,4000)})}
async function run(){const spine=(await (await fetch('/api/spine')).json()).beats.map(b=>b.beatId);
 let cur=0; let d=await decide(spine[0]); await preload(vids[0],d.playbackUrl);
 for(let i=0;i<spine.length;i++){const v=vids[cur], nv=vids[1-cur];
  v.classList.add('on'); const p=v.play().catch(()=>{}); window.__gatea.played.push({beat:spine[i],variant:d.variantId,propensity:d.propensity});
  hud.textContent='arm='+arm+'  beat '+(i+1)+'/'+spine.length+'  variant='+d.variantId.slice(-2)+'  p='+d.propensity.toFixed(3);
  let nd=null; if(i+1<spine.length){nd=await decide(spine[i+1]); await preload(nv,nd.playbackUrl);}
  await new Promise(r=>{const end=()=>{v.removeEventListener('ended',end);r()}; v.addEventListener('ended',end); if(fast)setTimeout(()=>{try{v.currentTime=Math.max(0,(v.duration||2)-0.2)}catch(e){}},800); setTimeout(r,8000)});
  if(i+1<spine.length){if(nv.readyState<3)window.__gatea.seamGaps++; v.classList.remove('on'); d=nd; cur=1-cur;}
 } window.__gatea.done=true; hud.textContent='arm='+arm+'  DONE  beats='+window.__gatea.played.length;}
run();
</script></body></html>`;
