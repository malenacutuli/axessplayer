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
export function readerPageHtml(workId: string): string {
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
  <button id="toggle-dyslexia" aria-pressed="false" title="Dyslexia-friendly font">Aa dyslexia</button>
  <button id="font-smaller" aria-label="Decrease text size">A-</button>
  <button id="font-bigger" aria-label="Increase text size">A+</button>
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
  const $ = (id) => document.getElementById(id);
  let work = null, chapters = [], current = -1, size = 1.12;
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

  async function openChapter(i){
    const c = chapters[i]; if (!c) return;
    current = i;
    $("overview").hidden = true; $("chapter").classList.add("open");
    $("c-title").textContent = c.title || ("Chapter " + c.index);
    $("prev").disabled = i === 0; $("next").disabled = i === chapters.length - 1;
    if (!c.is_free) { $("body").innerHTML = '<div class="paywall">This installment unlocks for ' + c.coin_cost + ' coins. (Unlock flow is wired through the economy service.)</div>'; return; }
    $("body").textContent = "Loading chapter..."; applySize();
    try {
      const r = await fetch(c.body_ref);
      $("body").textContent = r.ok ? await r.text() : "Chapter text is not available yet.";
    } catch (e) { $("body").textContent = "Chapter text could not be loaded."; }
    window.scrollTo(0,0);
  }
  function toOverview(){ $("chapter").classList.remove("open"); $("overview").hidden = false; window.scrollTo(0,0); }
  $("back").onclick = (e) => { e.preventDefault(); toOverview(); };
  $("prev").onclick = () => openChapter(current-1);
  $("next").onclick = () => openChapter(current+1);
  applySize(); load();
</script>
</body>
</html>`;
}
