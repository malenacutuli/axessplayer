// PROMPT 28 reader: a self-contained, accessibility-first reading view served by the content service. Given a
// work id it renders the work header and a clickable chapter list; selecting a chapter fetches its body_ref
// (the full text in storage) and renders it with reader typography. Accessibility is the wedge: a dyslexia
// friendly font toggle, adjustable size, semantic landmarks + aria so screen readers navigate it, and the
// audio-edition flag surfaced. No framework, no build step, no external assets (CSP-clean). No em dashes.

// HTML-escape for safe interpolation of the work id into the page (the only server-injected value).
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// The reader page. workId is validated by the route; everything else is fetched client-side from this same
// service (GET /works/:id) and from the chapter body_ref URLs (public storage), so the page is data-driven and
// stays correct as chapters change. Coin-locked chapters show a paywall affordance rather than the text.
// The reading discovery feed: a vertical grid of published works (mirrors /watch), each linking to /read/:id.
export function readFeedHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Read</title>
<style>
  :root{--bg:#0f1115;--fg:#e8e6e3;--muted:#9aa0a6;--accent:#22e3d0;--card:#161a21;}
  *{box-sizing:border-box;} body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}
  header{position:sticky;top:0;background:rgba(15,17,21,.95);border-bottom:1px solid #20252e;padding:.8rem 1rem;font-weight:700;}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.8rem;padding:1rem;max-width:1100px;margin:0 auto;}
  a.card{display:flex;flex-direction:column;text-decoration:none;color:inherit;background:var(--card);border:1px solid #20252e;border-radius:12px;overflow:hidden;min-height:150px;}
  a.card:hover{border-color:var(--accent);}
  .cover{aspect-ratio:3/4;background:#10131a center/cover no-repeat;display:flex;align-items:flex-end;padding:.6rem;}
  .cover .ttl{font-weight:700;font-size:1rem;text-shadow:0 1px 3px #000;}
  .sub{padding:.5rem .6rem;color:var(--muted);font-size:.8rem;}
  .syn{padding:0 .6rem .7rem;color:#c9cdd2;font-size:.82rem;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
  .loading{padding:2rem;color:var(--muted);}
</style></head><body>
<header>Read</header>
<main><p class="loading" id="status">Loading...</p><div class="grid" id="grid"></div></main>
<script>
  const $=(id)=>document.getElementById(id);
  fetch("/reading/works").then(r=>r.json()).then(items=>{
    $("status").style.display="none"; const g=$("grid");
    (items||[]).forEach(w=>{
      const a=document.createElement("a"); a.className="card"; a.href="/read/"+encodeURIComponent(w.id);
      a.innerHTML='<div class="cover" style="'+(w.cover_url?('background-image:url('+JSON.stringify(w.cover_url).slice(1,-1)+')'):'')+'"><span class="ttl">'+(w.title||"Untitled")+'</span></div>'
        +'<div class="sub">'+[w.genre,w.chapters+" ch",(w.free_chapters||0)+" free"].filter(Boolean).join(" . ")+'</div>'
        +'<div class="syn">'+(w.synopsis||"")+'</div>';
      g.appendChild(a);
    });
    if(!(items||[]).length){ $("status").style.display="block"; $("status").textContent="No works published yet."; }
  }).catch(()=>{ $("status").textContent="Could not load works."; });
</script></body></html>`;
}

export function readerPageHtml(workId: string, eventsBaseUrl = ""): string {
  const id = esc(workId);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Reader</title>
<style>
  :root { --bg:#0f1115; --fg:#e8e6e3; --muted:#9aa0a6; --accent:#22e3d0; --paper:#15181e; --maxw:720px; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font-family:Georgia,'Times New Roman',serif; line-height:1.7; }
  header.bar { position:sticky; top:0; background:rgba(15,17,21,.95); border-bottom:1px solid #23272f; padding:.6rem 1rem; display:flex; gap:.5rem; align-items:center; flex-wrap:wrap; }
  header.bar .title { font-weight:700; margin-right:auto; font-size:1rem; }
  button { background:var(--paper); color:var(--fg); border:1px solid #2c313a; border-radius:8px; padding:.4rem .7rem; cursor:pointer; font:inherit; }
  button:hover { border-color:var(--accent); }
  button[aria-pressed="true"] { border-color:var(--accent); color:var(--accent); }
  main { max-width:var(--maxw); margin:0 auto; padding:1.2rem 1.1rem 4rem; }
  .work-title { font-size:1.9rem; line-height:1.2; margin:.4rem 0 .2rem; }
  .synopsis { color:var(--muted); font-style:italic; margin:0 0 1rem; }
  .meta { color:var(--muted); font-size:.85rem; margin-bottom:1.2rem; }
  ol.toc { list-style:none; padding:0; margin:0 0 2rem; border-top:1px solid #23272f; }
  ol.toc li { border-bottom:1px solid #23272f; }
  ol.toc button.ch { width:100%; text-align:left; border:0; border-radius:0; background:transparent; padding:.85rem .2rem; display:flex; align-items:center; gap:.6rem; }
  ol.toc button.ch:hover { color:var(--accent); }
  .badge { font-family:system-ui,sans-serif; font-size:.7rem; border:1px solid #2c313a; border-radius:999px; padding:.1rem .5rem; color:var(--muted); }
  .badge.free { color:var(--accent); border-color:var(--accent); }
  #chapter { display:none; }
  #chapter.open { display:block; }
  #chapter h2 { font-size:1.5rem; margin:.2rem 0 1rem; }
  #body { white-space:pre-wrap; font-size:1.12rem; }
  .reading-dyslexia #body, .reading-dyslexia .work-title, .reading-dyslexia #chapter h2 { font-family:'Comic Sans MS','Trebuchet MS',Verdana,sans-serif; letter-spacing:.02em; word-spacing:.16em; line-height:1.9; }
  .paywall { background:var(--paper); border:1px solid #2c313a; border-radius:10px; padding:1.2rem; color:var(--muted); }
  .nav { display:flex; justify-content:space-between; margin-top:2rem; gap:.5rem; }
  a.back { color:var(--accent); text-decoration:none; font-family:system-ui,sans-serif; font-size:.9rem; }
  .loading { color:var(--muted); }
</style>
</head>
<body>
<header class="bar" role="banner">
  <span class="title" id="bar-title">Reader</span>
  <a class="back" href="/read" style="margin-right:.4rem">&larr; Browse</a>
  <button id="toggle-dyslexia" aria-pressed="false" title="Dyslexia-friendly font">Aa dyslexia</button>
  <button id="font-smaller" aria-label="Decrease text size">A-</button>
  <button id="font-bigger" aria-label="Increase text size">A+</button>
  <button id="follow" title="Follow: this could become a series">+ Follow</button>
  <button id="share" title="Share">Share</button>
</header>
<main id="app" aria-live="polite">
  <p class="loading" id="status">Loading...</p>
  <section id="overview" hidden>
    <h1 class="work-title" id="w-title"></h1>
    <p class="synopsis" id="w-synopsis"></p>
    <p class="meta" id="w-meta"></p>
    <nav aria-label="Chapters"><ol class="toc" id="toc"></ol></nav>
  </section>
  <article id="chapter" aria-label="Chapter">
    <a class="back" href="#" id="back">&larr; All chapters</a>
    <h2 id="c-title"></h2>
    <div id="body"></div>
    <div class="nav"><button id="prev">&larr; Previous</button><button id="next">Next &rarr;</button></div>
  </article>
</main>
<script>
  const WORK_ID = ${JSON.stringify(workId)};
  const EVENTS = ${JSON.stringify(eventsBaseUrl)};
  const $ = (id) => document.getElementById(id);
  let work = null, chapters = [], current = -1, size = 1.12;

  // Reading behavior feeds the SAME engagement pipeline as video (the demand sensor). A per-browser session
  // id (minted once) is sent as the bearer so events attribute to a stable reader. Best-effort, never blocks.
  function readerId(){ let s=localStorage.getItem("axp_reader"); if(!s){ s=(crypto.randomUUID?crypto.randomUUID():(Date.now()+"-"+Math.random()).replace(/\\D/g,"").padEnd(32,"0").slice(0,32)); localStorage.setItem("axp_reader",s);} return s; }
  function uuid4(){ return crypto.randomUUID?crypto.randomUUID():"xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g,c=>((Math.random()*16)|0).toString(16)); }
  function emit(name, props){
    if(!EVENTS) return; // events service not configured for this deploy
    try{
      fetch(EVENTS.replace(/\\/$/,"")+"/events", { method:"POST",
        headers:{ "content-type":"application/json", "authorization":"Bearer session:"+readerId() },
        body: JSON.stringify({ name, eventId: uuid4(), sessionId: readerId(), props: Object.assign({ work_id: WORK_ID }, props||{}) }),
        keepalive: true });
    }catch(e){}
  }
  function setStatus(t){ $("status").textContent = t; $("status").style.display = t ? "block" : "none"; }
  function applySize(){ $("body").style.fontSize = size.toFixed(2) + "rem"; }
  $("font-bigger").onclick = () => { size = Math.min(1.8, size+0.08); applySize(); };
  $("font-smaller").onclick = () => { size = Math.max(0.9, size-0.08); applySize(); };
  $("toggle-dyslexia").onclick = (e) => { const on = document.body.classList.toggle("reading-dyslexia"); e.currentTarget.setAttribute("aria-pressed", String(on)); };

  async function load(){
    try {
      const r = await fetch("/works/" + encodeURIComponent(WORK_ID));
      if (!r.ok) { setStatus("Work not found."); return; }
      const d = await r.json();
      work = d.work; chapters = d.chapters || [];
      $("bar-title").textContent = work.title || "Reader";
      $("w-title").textContent = work.title || "Untitled";
      $("w-synopsis").textContent = work.synopsis || "";
      $("w-meta").textContent = [work.genre, work.origin && work.origin.replace(/_/g," "), chapters.length + " chapters", work.ai_assisted ? "AI-assisted" : "human-written"].filter(Boolean).join("  .  ");
      const toc = $("toc"); toc.innerHTML = "";
      chapters.forEach((c, i) => {
        const li = document.createElement("li");
        const b = document.createElement("button"); b.className = "ch"; b.onclick = () => openChapter(i);
        const badge = document.createElement("span"); badge.className = "badge" + (c.is_free ? " free" : "");
        badge.textContent = c.is_free ? "Free" : (c.coin_cost + " coins");
        const t = document.createElement("span"); t.textContent = (c.title || ("Chapter " + c.index));
        b.append(badge, t); li.append(b); toc.append(li);
      });
      setStatus(""); $("overview").hidden = false;
    } catch (e) { setStatus("Could not load this work."); }
  }

  const completed = new Set();
  async function openChapter(i){
    const c = chapters[i]; if (!c) return;
    current = i;
    $("overview").hidden = true; $("chapter").classList.add("open");
    $("c-title").textContent = c.title || ("Chapter " + c.index);
    $("prev").disabled = i === 0; $("next").disabled = i === chapters.length - 1;
    if (!c.is_free) { $("body").innerHTML = '<div class="paywall">This installment unlocks for ' + c.coin_cost + ' coins. (Unlock flow is wired through the economy service.)</div>'; return; }
    emit("chapter_started", { chapter_index: c.index });
    $("body").textContent = "Loading chapter..."; applySize();
    try {
      const r = await fetch(c.body_ref);
      $("body").textContent = r.ok ? await r.text() : "Chapter text is not available yet.";
    } catch (e) { $("body").textContent = "Chapter text could not be loaded."; }
    window.scrollTo(0,0);
  }
  // Mark a chapter completed when the reader scrolls near the end of it; the last chapter completing is a
  // work_finished. completion rides in props so the demand sensor reads a real finish rate.
  function onScroll(){
    if($("chapter").classList.contains("open")===false) return;
    const c = chapters[current]; if(!c || !c.is_free || completed.has(c.index)) return;
    const doc=document.documentElement; const past=(window.scrollY+window.innerHeight)/(doc.scrollHeight||1);
    if(past>=0.9){ completed.add(c.index); emit("chapter_completed", { chapter_index: c.index, completion: 1 });
      if(current===chapters.length-1) emit("work_finished", { chapter_index: c.index }); }
  }
  window.addEventListener("scroll", onScroll, { passive:true });
  function toOverview(){ $("chapter").classList.remove("open"); $("overview").hidden = false; window.scrollTo(0,0); }
  $("back").onclick = (e) => { e.preventDefault(); toOverview(); };
  $("prev").onclick = () => openChapter(current-1);
  $("next").onclick = () => openChapter(current+1);
  $("follow").onclick = (e) => { emit("work_followed", {}); e.currentTarget.textContent = "Following"; e.currentTarget.setAttribute("aria-pressed","true"); };
  $("share").onclick = () => { emit("work_shared", {}); const url=location.href; if(navigator.share){ navigator.share({ title: (work&&work.title)||"Read", url }).catch(()=>{}); } else { navigator.clipboard&&navigator.clipboard.writeText(url); $("share").textContent="Link copied"; } };
  applySize(); load();
</script>
</body>
</html>`;
}
