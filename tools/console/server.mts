// Platform console: a single page that runs every plane's REAL library logic live and renders it. Dev
// tool, not shipped. Run: pnpm --filter @axessplayer/ingestion exec node --import tsx tools/console/server.mts
// Then open http://127.0.0.1:8123. No em dashes.
import { createServer } from "node:http";

const S = "/Users/malena/axessplayer/services";
// Plane libraries (real logic, imported by absolute path so tsx resolves the .ts sources).
const gatea = await import(`${S}/experiment/src/gatea/index.ts`);
const present = await import(`${S}/experiment/src/presentation.ts`);
const rec = await import(`${S}/recommender/src/index.ts`);
const money = await import(`${S}/monetization/src/index.ts`);
const trust = await import(`${S}/trust/src/trust.ts`);
const admin = await import(`${S}/admin/src/index.ts`);
const finops = await import(`${S}/generation/src/finops.ts`);
const vsrc = await import(`${S}/generation/src/variantSource.ts`);
const place = await import(`${S}/placement/src/index.ts`);
const lic = await import(`${S}/licensing/src/index.ts`);
const ing = await import(`${S}/ingestion/src/index.ts`);

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// In-memory TrustDB so the trust domain runs without Postgres.
function memTrustDb() {
  const creds = new Map<string, any>(); const chains = new Map<string, any[]>(); let n = 0;
  return {
    async insertCredential(beatVariantId: string, manifest: any, tier: string) { const r = { id: `c${++n}`, beat_variant_id: beatVariantId, manifest, tier }; creds.set(beatVariantId, r); return r; },
    async getCredential(id: string) { return creds.get(id) ?? null; },
    async getChainTip(id: string) { const c = chains.get(id) ?? []; if (!c.length) return null; const l = c[c.length - 1]; return { rowHash: l.row_hash, createdAt: l.content.created_at }; },
    async insertConsent(input: any, createdAt: string, prevHash: string | null, rowHash: string) { const row = { id: `k${++n}`, prev_hash: prevHash, row_hash: rowHash, content: { likeness_subject: input.likeness_subject, beat_variant_id: input.beat_variant_id, consent_ref: input.consent_ref, royalty_terms: input.royalty_terms ?? null, created_at: createdAt } }; const a = chains.get(input.beat_variant_id) ?? []; a.push(row); chains.set(input.beat_variant_id, a); return row; },
    async getConsentChain(id: string) { return chains.get(id) ?? []; },
  };
}

const PANELS: Record<string, { title: string; run: () => Promise<any> }> = {
  adaptive: { title: "P2 Adaptive engine - Gate A readout", run: async () => { const rows = gatea.simulateExperiment({ viewers: 8000, scenario: "lift" }); const r = gatea.gateAReadout(rows); return { gateA: r.gateA, controlD7: +(r.control.d7Return * 100).toFixed(2), treatmentD7: +(r.treatment.d7Return * 100).toFixed(2), d7DiffPct: +(r.d7.diff * 100).toFixed(2), ci: [+(r.d7.lo * 100).toFixed(2), +(r.d7.hi * 100).toFixed(2)], verdict: r.d7.verdict, guardrailsOk: r.guardrails.ok }; } },
  recommender: { title: "P5 Recommender - retrieval + ranking", run: async () => { const rows = [ { viewerId: "v1", seriesId: "thriller-key", completion: 0.9, watchMs: 9000, durationMs: 10000, returned: true }, { viewerId: "v2", seriesId: "thriller-key", completion: 0.85, watchMs: 8400, durationMs: 10000, returned: true }, { viewerId: "v3", seriesId: "slow-romance", completion: 0.35, watchMs: 4000, durationMs: 10000, returned: false } ]; const store = new rec.InMemoryFeatureStore(rows); const t = rec.identityTower(rec.FEATURE_DIM); const items = store.allItems().map((i: any) => ({ seriesId: i.seriesId, embedding: rec.embed(t, i.vector) })); const retrieved = rec.retrieveTopK(rec.embed(t, store.viewer("v1").vector), items, 5); const ranked = rec.rankCandidates(store.allItems().map((i: any) => ({ seriesId: i.seriesId, features: i.vector }))); return { retrievedTopK: retrieved, rankedFeed: ranked }; } },
  monetization: { title: "P6 Monetization - paywall bandit + settlement", run: async () => { const offer = money.selectOffer(money.DEFAULT_OFFERS, { pack_small: 0.2, pack_medium: 0.5, pack_large: 0.1 }, 0.1, rng(7)); const grant = money.grantFromCheckout({ id: "cs_test_1", payment_status: "paid", livemode: false, metadata: { userId: "u1", offerId: "pack_medium" } }, money.DEFAULT_OFFERS); const live = money.grantFromCheckout({ id: "cs_live_1", payment_status: "paid", livemode: true, metadata: { userId: "u1", offerId: "pack_small" } }, money.DEFAULT_OFFERS); return { selectedOffer: offer, testCheckoutGrant: grant, livemodeRefused: live }; } },
  trust: { title: "P7 Trust - provenance + consent verify", run: async () => { const svc = new trust.TrustService(memTrustDb()); const v = "11111111-1111-1111-1111-111111111111"; await svc.recordProvenance({ beat_variant_id: v, tier: "C_ai", generator: "factory", asset_hash: "deadbeef", created_at: "2026-06-17T00:00:00Z" }); await svc.appendConsent({ likeness_subject: "actor:strawberry", beat_variant_id: v, consent_ref: "DPA-2026-001" }); const ok = await svc.verifyVariant(v); const missing = await svc.verifyVariant("00000000-0000-0000-0000-000000000000"); return { servableVariant: ok, unservableVariant: missing }; } },
  admin: { title: "P9 Admin - policy alerts + moderation + payouts", run: async () => { const alerts = admin.policyAlerts([ { seriesId: "s1", gateA: "green", guardrailsOk: false, d7Diff: 0.05, viewers: 1000 }, { seriesId: "s2", gateA: "flat_or_negative", guardrailsOk: true, d7Diff: -0.03, viewers: 1000 }, { seriesId: "s3", gateA: "green", guardrailsOk: true, d7Diff: 0.06, viewers: 1000 } ]); const item = { id: "m1", subjectId: "v1", kind: "user_report", state: "pending" as const, createdAt: "2026-06-17T00:00:00Z" }; const decided = admin.decide(item, { decision: "approved", reviewer: "op1", reason: "ok", at: "2026-06-17T01:00:00Z" }); const payouts = admin.allPayoutReports([{ creatorId: "alice", coins: 1200 }, { creatorId: "bob", coins: 300 }]); return { policyAlerts: alerts, moderationDecision: { state: decided.state, reviewer: decided.reviewer }, payoutReports: payouts }; } },
  generation: { title: "P10 Generation - FinOps gate + variant source", run: async () => { const denied = await vsrc.resolveVariantSource({ kind: "spec", request: { tier: "C_ai" } as any, estimatedShots: 2 }, { budget: finops.DENY_ALL, generate: async () => ({ playbackUrl: "x" }) }); const fenced = await vsrc.resolveVariantSource({ kind: "spec", request: { tier: "B_likeness" } as any, estimatedShots: 1 }, { budget: { capUsd: 1000, spentUsd: 0 }, generate: async () => ({ playbackUrl: "x" }) }); const generated = await vsrc.resolveVariantSource({ kind: "spec", request: { tier: "C_ai" } as any, estimatedShots: 2 }, { budget: { capUsd: 100, spentUsd: 0 }, generate: async () => ({ playbackUrl: "https://cdn/gen.m3u8" }) }); return { defaultDeny: denied, beTheProtagonistFenced: fenced, generatedWithBudget: generated }; } },
  placement: { title: "P11 Brand placement - safety + plane firewall + market", run: async () => { const scene = { rating: "PG" as const }; const sel = place.selectPlacement({ beatVariantId: "v1", slotId: "s1" }, [ { placement: { brandId: "soda", category: "soda" }, bidUsd: 5 }, { placement: { brandId: "booze", category: "alcohol" }, bidUsd: 100 } ], scene, 0, rng(3)); let firewall = "ad-CTR allowed into cut selection (BUG)"; try { place.assertNotAdPlaneDriven(["completion", "ad_ctr"]); } catch (e: any) { firewall = e.message; } const eligible = place.eligibleCampaigns([ { id: "c1", brandId: "soda", category: "soda", budgetUsd: 100, spentUsd: 0, maxBidUsd: 5, targetRatings: ["PG"] }, { id: "c2", brandId: "booze", category: "alcohol", budgetUsd: 100, spentUsd: 0, maxBidUsd: 50, targetRatings: ["PG"] } ], scene); return { selectedSafePlacement: sel, planeFirewall: firewall, eligibleCampaigns: eligible.map((c: any) => c.id) }; } },
  licensing: { title: "P12 Licensing - tenant + API key + metering + billing", run: async () => { const t = lic.provision("t1", "Acme Media", "standard"); const key = lic.issueApiKey("k1", "t1", "axp_live_3kZ9_secret_material"); const verified = lic.verifyApiKey("axp_live_3kZ9_secret_material", [key]); let meter = { tenantId: "t1", includedCredits: 100, usedCredits: 90, hardCap: 120 }; const seen = new Set<string>(); meter = lic.recordUsage(meter, 20, "evt-1", seen).tenant; const inv = lic.invoice(meter, "standard"); return { tenant: { id: t.id, status: t.status, plan: t.plan }, apiKey: { prefix: key.prefix, verifiedTenant: verified, hashOnly: key.hash.slice(0, 16) + "..." }, metering: { used: meter.usedCredits, remaining: lic.remaining(meter) }, invoice: inv }; } },
  ingestion: { title: "P13 Content factory - cost-gated ingest DAG", run: async () => { const stages = ing.accessibilityStages(["en", "es", "fr", "de", "it", "pt"], ["ASL", "PSL", "LSA"], "en"); const total = ing.estimateIngestCostUsd(stages.map((s: any) => s.kind)); const exec = ing.makeExecutor({ baseLang: "en", mediaDirUrl: "http://m/", presentFiles: [], build: async (s: any) => ({ file: `${s.id}.out`, costUsd: ing.STAGE_COST_USD[s.kind] }) }); const reg: string[] = []; const registrar = async (s: any, a: string) => { const f = ing.stageTrackField(s); if (f) reg.push(`${f}${s.lang ? `[${s.lang}]` : ""}`); }; const cappedJob = ing.initJob("c", "series", "hero", total / 2, stages); const r1 = await ing.runJob(cappedJob, stages, { execute: exec, register: registrar }); cappedJob.budgetUsd = total + 1; const r2 = await ing.runJob(cappedJob, stages, { execute: exec, register: registrar }); return { totalStages: stages.length, fullCostUsd: +total.toFixed(2), cappedAt: +(total / 2).toFixed(2), pausedAfter: r1.ranStageIds.length, resumedTo: ing.isComplete(cappedJob), registeredTracks: [...new Set(reg)] }; } },
};

const HTML = `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Axessplayer Platform Console</title><style>
:root{--bg:#0e0b14;--card:#171221;--line:#2a2238;--ink:#ece7f5;--mut:#9a8fb5;--ok:#46d39a;--warn:#f0c14b;--err:#ff5c7a;--brand:#8b7bf0}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui}
header{padding:18px 24px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:2}
h1{margin:0;font-size:18px}.sub{color:var(--mut);font-size:12px;margin-top:4px}
.apps{margin-top:10px;display:flex;gap:8px;flex-wrap:wrap}.apps a{color:var(--brand);text-decoration:none;border:1px solid var(--line);padding:4px 10px;border-radius:999px;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px;padding:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;overflow:hidden}
.card h2{margin:0 0 8px;font-size:13px;letter-spacing:.02em}
.badge{float:right;font:11px ui-monospace,monospace;padding:2px 8px;border-radius:999px;border:1px solid var(--line)}
.ok{color:var(--ok);border-color:var(--ok)}.warn{color:var(--warn);border-color:var(--warn)}.err{color:var(--err);border-color:var(--err)}
pre{margin:8px 0 0;font:11px/1.45 ui-monospace,monospace;color:var(--mut);white-space:pre-wrap;word-break:break-word;max-height:280px;overflow:auto}
.kv{display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px solid #ffffff0d}.kv b{color:var(--ink)}
</style></head><body>
<header><h1>Axessplayer Platform Console</h1><div class=sub>Every plane's real library logic, run live. Refresh re-runs each scenario.</div>
<div class=apps><a href="http://localhost:5173" target=_blank>Consumer app (5173)</a><a href="http://localhost:5174" target=_blank>Studio (5174)</a><a href="http://127.0.0.1:8097/?arm=treatment" target=_blank>Gate A player (8097)</a></div></header>
<div class=grid id=grid></div>
<script>
const panels = ${JSON.stringify(Object.entries(PANELS).map(([k, v]) => ({ k, title: v.title })))};
const grid = document.getElementById('grid');
function statusOf(k, d){ if(k==='adaptive') return d.gateA==='green'?['ok','GATE A GREEN']:['warn',d.gateA.toUpperCase()]; if(k==='trust') return d.servableVariant?.servable?['ok','SERVABLE']:['warn','check']; if(k==='ingestion') return d.resumedTo?['ok','RESUMED OK']:['warn','paused']; if(k==='generation') return ['ok','GATED']; if(k==='placement') return ['ok','SAFE']; return ['ok','LIVE']; }
function kvs(obj){ return Object.entries(obj).slice(0,6).map(([k,v])=>'<div class=kv><span>'+k+'</span><b>'+(typeof v==='object'?JSON.stringify(v).slice(0,42):v)+'</b></div>').join(''); }
async function load(){ grid.innerHTML=''; for(const p of panels){ const card=document.createElement('div'); card.className='card'; card.innerHTML='<h2>'+p.title+' <span class=badge>...</span></h2><pre>running</pre>'; grid.appendChild(card); try{ const d=await (await fetch('/api/'+p.k)).json(); const [cls,lbl]=statusOf(p.k,d); card.querySelector('.badge').className='badge '+cls; card.querySelector('.badge').textContent=lbl; card.querySelector('pre').textContent=JSON.stringify(d,null,1); }catch(e){ card.querySelector('.badge').className='badge err'; card.querySelector('.badge').textContent='ERROR'; card.querySelector('pre').textContent=String(e); } } }
load();
</script></body></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const key = url.pathname.slice(5);
    const panel = PANELS[key];
    res.writeHead(panel ? 200 : 404, { "content-type": "application/json", "access-control-allow-origin": "*" });
    if (!panel) return res.end(JSON.stringify({ error: "unknown panel" }));
    try { res.end(JSON.stringify(await panel.run())); } catch (e: any) { res.end(JSON.stringify({ error: e?.message ?? String(e) })); }
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(HTML);
});
const PORT = Number(process.env.PORT ?? 8123);
server.listen(PORT, "127.0.0.1", () => console.log(`platform console on http://127.0.0.1:${PORT}`));
