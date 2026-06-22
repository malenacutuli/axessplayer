// PROMPT 28 sibling surface: the WATCH app UI. Same self-contained, accessibility-first, framework-free
// pattern as the reader, but for the adaptive video series. Two pages:
//   watchFeedHtml()        - a vertical BookTok-style discovery grid of published series (GET /watch)
//   watchPlayerHtml(id)    - a 9:16 vertical player that walks the series graph (episode -> beats -> the
//                            selected cut per beat), with the signature accessibility: speaker-colored CWI
//                            captions synced to playback, audio-description + sign-language toggles, cut
//                            selection (intensity/POV), language/dub switch, and a coin-unlock overlay for
//                            premium installments. Data-driven from this service (/feed, /series/:id/graph).
// No framework, no external assets. No em dashes.

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const SHELL_HEAD = `<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />`;

// The discovery feed: a responsive grid of published series, each tile linking to the player.
export function watchFeedHtml(): string {
  return `<!doctype html><html lang="en"><head>${SHELL_HEAD}<title>Watch</title>
<style>
  :root{--bg:#0b0d12;--fg:#f2f2f4;--muted:#9aa0a6;--accent:#22e3d0;--card:#161a21;}
  *{box-sizing:border-box;} body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}
  header{position:sticky;top:0;background:rgba(11,13,18,.95);border-bottom:1px solid #20252e;padding:.8rem 1rem;font-weight:700;}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.8rem;padding:1rem;max-width:1100px;margin:0 auto;}
  a.card{display:block;text-decoration:none;color:inherit;background:var(--card);border:1px solid #20252e;border-radius:12px;overflow:hidden;}
  a.card:hover{border-color:var(--accent);}
  .poster{aspect-ratio:9/16;background:#10131a center/cover no-repeat;display:flex;align-items:flex-end;}
  .poster .ttl{padding:.5rem .6rem;font-weight:600;font-size:.92rem;text-shadow:0 1px 3px #000;}
  .sub{padding:.3rem .6rem .7rem;color:var(--muted);font-size:.78rem;}
  .loading{padding:2rem;color:var(--muted);}
</style></head><body>
<header>Watch</header>
<main><p class="loading" id="status">Loading...</p><div class="grid" id="grid"></div></main>
<script>
  const $=(id)=>document.getElementById(id);
  fetch("/feed").then(r=>r.json()).then(d=>{
    const items=Array.isArray(d)?d:(d.series||[]);
    $("status").style.display="none";
    const g=$("grid");
    items.forEach(s=>{
      const a=document.createElement("a"); a.className="card"; a.href="/watch/"+encodeURIComponent(s.id);
      const art=s.poster_url||s.cover_url;
      a.innerHTML='<div class="poster" style="'+(art?('background-image:url('+JSON.stringify(art).slice(1,-1)+')'):'')+'"><span class="ttl">'+(s.title||"Untitled")+'</span></div><div class="sub">'+[s.genre,(s.available_languages||[]).join("/")].filter(Boolean).join(" . ")+'</div>';
      g.appendChild(a);
    });
    if(!items.length) $("status").style.display="block", $("status").textContent="No series published yet.";
  }).catch(()=>{ $("status").textContent="Could not load the feed."; });
</script></body></html>`;
}

// The vertical player. Walks the series graph, plays the selected cut per beat, and renders accessibility.
export function watchPlayerHtml(seriesId: string): string {
  return `<!doctype html><html lang="en"><head>${SHELL_HEAD}<title>Watch</title>
<style>
  :root{--fg:#fff;--muted:#b9bfc6;--accent:#22e3d0;}
  *{box-sizing:border-box;} html,body{height:100%;} body{margin:0;background:#000;color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden;}
  .stage{position:relative;height:100dvh;display:flex;align-items:center;justify-content:center;background:#000;}
  video{height:100%;max-width:100%;aspect-ratio:9/16;background:#000;object-fit:contain;}
  .topbar{position:absolute;top:0;left:0;right:0;display:flex;gap:.5rem;align-items:center;padding:.7rem .9rem;background:linear-gradient(#000a,transparent);z-index:5;}
  .topbar .t{font-weight:700;margin-right:auto;text-shadow:0 1px 3px #000;}
  a.back{color:var(--accent);text-decoration:none;font-size:.9rem;}
  button{background:#0008;color:#fff;border:1px solid #fff4;border-radius:8px;padding:.35rem .6rem;font:inherit;cursor:pointer;}
  button[aria-pressed="true"]{border-color:var(--accent);color:var(--accent);}
  /* CWI captions overlay */
  #cap{position:absolute;left:0;right:0;bottom:14%;text-align:center;padding:0 1rem;z-index:6;pointer-events:none;}
  #cap .seg{display:inline-block;background:#000a;border-radius:10px;padding:.3rem .7rem;font-size:1.4rem;font-weight:700;line-height:1.35;max-width:90%;}
  #cap .w.loud{font-size:1.15em;} #cap .w.screaming{font-size:1.35em;text-transform:uppercase;} #cap .w.quiet{opacity:.75;font-weight:500;}
  #ad-text{position:absolute;left:0;right:0;top:12%;text-align:center;padding:0 1.2rem;z-index:6;pointer-events:none;}
  #ad-text:not(:empty){}
  #ad-text span,#ad-text{color:#ffd27a;font-style:italic;font-size:1rem;text-shadow:0 1px 3px #000;}
  .cuts{position:absolute;bottom:5%;left:0;right:0;display:flex;gap:.4rem;justify-content:center;flex-wrap:wrap;z-index:6;padding:0 1rem;}
  .cuts button.active{background:var(--accent);color:#000;border-color:var(--accent);}
  .sign{position:absolute;right:.7rem;bottom:18%;width:28%;max-width:160px;aspect-ratio:9/16;border:2px solid #fff6;border-radius:10px;background:#111;z-index:6;display:none;}
  .sign.on{display:block;}
  .overlay{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:#000b;z-index:8;text-align:center;padding:2rem;}
  .overlay.on{display:flex;} .overlay .box{background:#161a21;border:1px solid #2c313a;border-radius:14px;padding:1.6rem;max-width:340px;}
  .nav{position:absolute;bottom:.6rem;left:0;right:0;display:flex;justify-content:space-between;padding:0 1rem;z-index:6;}
  .empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted);text-align:center;padding:2rem;}
  .menu{position:absolute;top:3rem;right:.9rem;background:#161a21;border:1px solid #2c313a;border-radius:10px;padding:.5rem;display:none;flex-direction:column;gap:.4rem;z-index:7;}
  .menu.on{display:flex;}
</style></head><body>
<div class="stage" aria-label="Video player" role="application">
  <div class="topbar">
    <a class="back" href="/watch">&larr; Browse</a>
    <span class="t" id="t-title">Loading...</span>
    <button id="cc" aria-pressed="true" title="Captions">CC</button>
    <button id="more" aria-haspopup="true">A11y</button>
  </div>
  <div class="menu" id="menu" role="menu">
    <button id="ad" role="menuitemcheckbox" aria-pressed="false">Audio description</button>
    <button id="sign-btn" role="menuitemcheckbox" aria-pressed="false">Sign language</button>
    <button id="lang" role="menuitem">Language: <span id="lang-v">base</span></button>
  </div>
  <video id="v" playsinline preload="metadata"></video>
  <video id="signv" class="sign" muted playsinline loop aria-hidden="true"></video>
  <div id="cap" aria-live="off"></div>
  <div id="ad-text" aria-live="polite"></div>
  <div class="cuts" id="cuts" role="group" aria-label="Cut selection"></div>
  <div class="nav"><button id="prev">&larr; Prev</button><button id="next">Next &rarr;</button></div>
  <div class="overlay" id="paywall"><div class="box"><h3 id="pw-title">Premium cut</h3><p id="pw-sub" class="">Unlock this installment to continue.</p><button id="pw-btn">Unlock</button></div></div>
  <div class="empty" id="empty" hidden></div>
</div>
<script>
  const SERIES_ID=${JSON.stringify(seriesId)};
  const $=(id)=>document.getElementById(id);
  const v=$("v"), signv=$("signv");
  let beats=[], bi=0, sel={}, caps=null, capByBeat={}, ccOn=true;
  // Audio description: a timed doc {segments:[{startTime,endTime,text,audioUrl}]}. When on, the matching
  // segment's audio plays and its text shows; the main track ducks while a description speaks.
  let adOn=false, adDoc=null, adAudio=new Audio(), adActive=-1;
  // Dub language: null = base track; otherwise play the dub audio synced to the (muted) video.
  let dubLang=null, dubAudio=new Audio(), dubAvail={};

  function flatten(graph){
    const eps=(graph.episodes||[]).slice().sort((a,b)=>(a.episode_number||0)-(b.episode_number||0));
    const out=[];
    eps.forEach(ep=>(ep.beats||[]).slice().sort((a,b)=>(a.beat_index||0)-(b.beat_index||0)).forEach(b=>out.push(b)));
    return out;
  }
  function variantsOf(b){ return (b.variants||[]).filter(x=>x.playback_url); }
  function pick(b){ const vs=variantsOf(b); if(!vs.length) return null; const id=sel[b.id]; return vs.find(x=>x.id===id)||vs.find(x=>!x.is_premium)||vs[0]; }

  async function load(){
    const r=await fetch("/series/"+encodeURIComponent(SERIES_ID)+"/graph");
    if(!r.ok){ showEmpty("Series not found."); return; }
    const g=await r.json();
    $("t-title").textContent=(g.series&&g.series.title)||"Watch";
    document.title=$("t-title").textContent;
    beats=flatten(g);
    const playable=beats.filter(b=>variantsOf(b).length>0);
    if(!playable.length){ showEmpty((($("t-title").textContent))+" is published but its cuts are not produced yet. Beats: "+beats.length+"."); return; }
    bi=beats.findIndex(b=>variantsOf(b).length>0); if(bi<0)bi=0;
    renderBeat();
  }
  function showEmpty(msg){ $("empty").hidden=false; $("empty").textContent=msg; v.style.display="none"; }

  async function renderBeat(){
    const b=beats[bi]; if(!b) return;
    const chosen=pick(b);
    renderCuts(b, chosen);
    $("prev").disabled=bi<=0; $("next").disabled=bi>=beats.length-1;
    $("paywall").classList.remove("on");
    if(!chosen){ $("next").click&&0; return; }
    if(chosen.is_premium && !chosen._unlocked){
      $("pw-title").textContent=(b.role||"Premium")+" cut"; $("pw-sub").textContent="Unlock for "+chosen.coin_cost+" coins to continue.";
      $("pw-btn").onclick=()=>{ chosen._unlocked=true; renderBeat(); }; // unlock flow wires to the economy service
      $("paywall").classList.add("on");
    }
    v.src=chosen.playback_url; v.play().catch(()=>{});
    setupSign(chosen); await setupCaptions(b, chosen); await setupAd(chosen); setupDub(chosen);
  }

  function renderCuts(b, chosen){
    const vs=variantsOf(b); const box=$("cuts"); box.innerHTML="";
    if(vs.length<2) return;
    vs.forEach(x=>{
      const btn=document.createElement("button");
      btn.textContent=(x.pov?("POV "+x.pov):("Intensity "+x.intensity))+(x.is_premium?" *":"");
      if(chosen&&x.id===chosen.id) btn.className="active";
      btn.onclick=()=>{ sel[b.id]=x.id; renderBeat(); };
      box.appendChild(btn);
    });
  }

  // CWI captions: fetch the caption doc once per beat, render the active segment with speaker color + per-word
  // intensity styling, synced to video.currentTime. This is the accessibility signature, not an afterthought.
  async function setupCaptions(b, chosen){
    capByBeat={}; $("cap").innerHTML="";
    const url=chosen.caption_doc_url; if(!url||!ccOn){ return; }
    try{ const r=await fetch(url); if(r.ok) capByBeat[b.id]=await r.json(); }catch(e){}
  }
  function tick(){
    const b=beats[bi];
    // CWI captions
    const doc=b&&capByBeat[b.id];
    if(doc&&ccOn){
      const t=v.currentTime, segs=doc.segments||[];
      const seg=segs.find(s=>t>=(s.startTime||0)&&t<=(s.endTime||0));
      if(seg){ const color=seg.speakerColor||"#fff";
        const words=(seg.words||[]).map(w=>'<span class="w '+(w.intensity||"")+'">'+(w.text||"")+'</span>').join(" ")||(seg.text||"");
        $("cap").innerHTML='<span class="seg" style="color:'+color+'">'+words+'</span>'; }
      else $("cap").innerHTML="";
    } else if(!ccOn) $("cap").innerHTML="";
    // Audio description: play the timed description audio + show its text, ducking the main track.
    if(adOn&&adDoc){
      const t=v.currentTime, segs=adDoc.segments||[];
      const i=segs.findIndex(s=>t>=(s.startTime||0)&&t<=(s.endTime||0));
      if(i>=0&&i!==adActive){ adActive=i; const s=segs[i];
        if(s.audioUrl){ adAudio.src=s.audioUrl; adAudio.play().catch(()=>{}); v.volume=0.25; }
        $("ad-text")&&($("ad-text").textContent=s.text||""); }
      else if(i<0&&adActive!==-1){ adActive=-1; v.volume=1; if($("ad-text"))$("ad-text").textContent=""; }
    }
    // Dub: keep the dub audio aligned with the (muted) video.
    if(dubLang){ if(Math.abs(dubAudio.currentTime-v.currentTime)>0.35) dubAudio.currentTime=v.currentTime; }
  }
  function setupSign(chosen){
    if(chosen.sign_video_url && signOn){ signv.src=chosen.sign_video_url; signv.classList.add("on"); signv.currentTime=0; signv.play().catch(()=>{}); }
    else { signv.classList.remove("on"); signv.removeAttribute("src"); }
  }
  async function setupAd(chosen){
    adDoc=null; adActive=-1;
    if(!chosen.audio_description_url) return;
    try{ const r=await fetch(chosen.audio_description_url); if(r.ok) adDoc=await r.json(); }catch(e){}
  }
  function setupDub(chosen){
    dubAvail=chosen.dub_audio_urls||{};
    if(dubLang && dubAvail[dubLang]){ dubAudio.src=dubAvail[dubLang]; v.muted=true; dubAudio.currentTime=v.currentTime; dubAudio.play().catch(()=>{}); }
    else { dubLang=null; v.muted=adOn?false:v.muted; dubAudio.pause(); dubAudio.removeAttribute("src"); }
  }

  let signOn=false;
  $("cc").onclick=(e)=>{ ccOn=!ccOn; e.currentTarget.setAttribute("aria-pressed",String(ccOn)); if(!ccOn)$("cap").innerHTML=""; };
  $("more").onclick=()=>$("menu").classList.toggle("on");
  $("ad").onclick=()=>{ adOn=!adOn; $("ad").setAttribute("aria-pressed",String(adOn)); v.volume=1; adActive=-1; if(!adOn){ adAudio.pause(); if($("ad-text"))$("ad-text").textContent=""; } };
  $("sign-btn").onclick=()=>{ signOn=!signOn; $("sign-btn").setAttribute("aria-pressed",String(signOn)); const b=beats[bi],ch=b&&pick(b); if(ch)setupSign(ch); };
  // Language: cycle base -> each available dub. Mutes the video and plays the dub track in sync.
  $("lang").onclick=()=>{ const b=beats[bi],ch=b&&pick(b); const langs=[null].concat(Object.keys(ch&&ch.dub_audio_urls||{})); const cur=langs.indexOf(dubLang); dubLang=langs[(cur+1)%langs.length]; $("lang-v").textContent=dubLang||"base"; if(ch)setupDub(ch); };
  // keep the dub track playing/pausing with the video
  v.addEventListener("play",()=>{ if(dubLang) dubAudio.play().catch(()=>{}); });
  v.addEventListener("pause",()=>{ dubAudio.pause(); });
  $("prev").onclick=()=>{ if(bi>0){bi--; renderBeat();} };
  $("next").onclick=()=>{ if(bi<beats.length-1){bi++; renderBeat();} };
  v.addEventListener("timeupdate",tick);
  v.addEventListener("ended",()=>{ adAudio.pause(); dubAudio.pause(); if(bi<beats.length-1){bi++; renderBeat();} });
  load();
</script></body></html>`;
}
