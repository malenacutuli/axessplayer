# Gold standard addendum: competitive intelligence and strategic position

**Holywater (My Drama), Rembrand + Mirriad, and Showrunner (Fable), and what it means for Axessplayer. June 2026. No em dashes.**

A deep competitive-intel pass (sourced, see end) on the generative micro-drama leader and the dynamic-brand-
placement leaders. This file keeps the decision-relevant conclusions and the advisor corrections. Figures are as
of June 2026, vendor-reported unless noted, and several post-date the advisor knowledge cutoff so are unverified
here; treat market and lift numbers as directional.

## What the competitors actually are

- Holywater (My Drama / My Passion / My Muse / Freebits): an orchestration-and-data-flywheel company over
  commodity frontier models (Gemini 2.5 Pro, Veo 3, Midjourney, Flux, Runway, Kling, ElevenLabs, LLaMA, Stable
  Diffusion). The moat is the My Passion books to AI-pilot to paid-UA-test to full-production to data loop, plus a
  paid-marketing engine (80% of revenue is UA-driven), 85M+ downloads, terabytes of engagement data, ~$70-90M ARR.
  Founders state the moat is "terabytes of proprietary data" and process, NOT any model. Subscriptions retain ~2x
  better than coin/IAP (Nesvit). ~90% completion and "main character personalization" are marketed but undocumented
  at the architecture level (inferred, not proven).
- Rembrand: "physics-informed generative fusion," reconstructs 3D scene geometry/lighting from 2D frames and
  composites a photoreal product in hours. Post-production, not real-time. Thinner patent position than Mirriad.
- Mirriad: ~2-decade computer-vision VPP heritage; the pivotal patent family for per-viewer swapping is NIVA DAI
  (ABR variant selection per viewer) plus ZoneSense (insertion-zone detection in pre-existing video). Financially
  distressed (near administration in 2025, nano-cap). The July 2025 Rembrand JV took its US operations.
- Region-addressable brand swapping is pre-rendered variant segments selected via ABR manifest + server-side ad
  insertion (Harmonic VOS360) with decisioning by Google Ad Manager / Magnite SpringServe. NOT real-time per-frame.

## What this means for Axessplayer (the corrections)

### CI1. Match the flywheel posture, not the model list. (Validates the build.)
Be an orchestration-and-data company over commodity models, model-agnostic so models hot-swap as the frontier
moves. Axessplayer's variant interface already does this. Do NOT try to out-model the labs.

### CI2. Generation-time placement is the structural advantage. (Validates the placement plane.)
Because Axessplayer generates the scene, it places brands at generation time with ground-truth geometry and
lighting, and can adapt wardrobe/setting/dialogue per brand/region. Rembrand must reconstruct 3D from 2D; Mirriad
must track. Their VPP patents assume insertion into already-shot footage, so a generation-time placement path is
likely navigable (commission a formal FTO on ABR variant-serving and dynamic-selection claims before shipping).
This matches the prior FTO design-around (slot-at-authoring, render-into-frame, not detect-and-composite).

### CI3. The flywheel is audience x content-volume x UA capital, which Axessplayer does not have. (The hard truth.)
"Build Holywater's flywheel" is a funded-company strategy. Holywater runs it on 85M downloads, 3M book users, and
80%-of-revenue paid UA. Axessplayer has one hero series and no audience. Do NOT enter a generation-speed/cost arms
race (beat 1 day/minute, beat cost-per-hour); that competes on Holywater's terms where their data and capital lead
is insurmountable. The flywheel matters only after there is audience and capital.

### CI4. The white space the whole field leaves open is Axessplayer's wedge.
Holywater, ReelShort, DramaBox, Rembrand, Mirriad: not one leads with accessibility, consent, provenance, or
EU-sovereign compliance. The field races on generation speed and monetization aggression. Axessplayer's defensible
position is the game none of them play: accessibility as a first-class product (CWI, sign, AD, dubbing), the
consent/provenance/sovereignty layer the EU is about to mandate, and the disabled audience nobody serves, combined
with owning content + audience + placement + data in one stack. Adopt their proven payment stack (coins, rewarded
ads, subscription; subs retain ~2x better) and orchestration posture; win on the wedge they ignore.

### CI5. Identity-locking is the real serialized-content bottleneck. (Keep it first-class.)
Holywater bought Jeynix (face-replacement/de-aging/lip-sync) because identity consistency across episodes and
localized dubs is the actual bottleneck for serialized content. Axessplayer's generation plane (prompt 09) already
has identity locking; keep it first-class and consider it a priority, not a nice-to-have.

### CI6. Mirriad distress is a someday-if-funded IP/acqui-hire option, not a now move.
Mirriad's IP (CV tracking, the NIVA DAI/ZoneSense families) and team are cheaply acquirable and could neutralize
patent risk. Real option if/when Axessplayer is funded; a distraction for a solo founder now.

### CI7. The per-viewer-recut moat is greenfield AND unproven, both true.
Even the market leader's "main character personalization" is undocumented and marketed, not demonstrated. So the
adaptive-recut moat is genuinely white space (nobody has proven it) and genuinely unproven (nobody has proven it).
Do not claim it works until measured (ties to CORRECTIONS C1).

## Showrunner (Fable) Discord, observed June 2026

A primary-source read of Showrunner's public Discord "create" channel, late March to mid June 2026 (about 89 scene
events). This is the create channel only, not their internal metrics, so health claims are inference from one
surface, not measured DAU/retention/revenue.

### What it is and how it works
An AI-video CREATION tool in Discord, not a consumption feed. Users run `/scene` with a structured controlled
vocabulary: Set (location), Characters, Action (fixed list: "Eating - Bag of Chips", "Activity Stocks", "Emotional
Breakdown", "Laughing at own Joke"), Walking (blocking: "Enters then Exits (Group)"), Prop, Filter. "AI Continue",
"AI Crazified", and "Redo" extend or mutate a scene; a "combine" step stitches scenes into full "stories" (the Sim
New York / Sim Berlin pieces). Everything lives in one persistent universe, "Celebrity Dad Joke Roast", with a fixed
character roster. Output is hosted on Supabase public storage (same stack as Axessplayer).

### CI8. Their authoring UI is the Scene Genome. Borrow it. (Validates structured authoring.)
The `/scene` controlled-vocabulary composer (set, characters, action, blocking, prop, filter) is exactly the
`variant_axis` structure in Axessplayer's beat_variants, exposed as the creation interface. Compose-along-fixed-axes
is good product AND it keeps the decision engine's data clean (every scene is tagged by construction). Adopt it in
the Studio authoring flow. See the build note: docs/product/notes/SCENE_SPEC_COMPOSER.md (prompt 22).

### CI9. Showrunner is the live exhibit for why the consent moat matters. (Weaponize it.) [Certain from logs]
They generate Tim Cook, Elon Musk, Barack Obama, Keanu Reeves, Will Smith and others by name and likeness, saying
arbitrary user-scripted things, including defamatory and edgy content (a Princess Diana death joke, an "Epstein kid"
prop, misogynistic political prompts), with no consent, no provenance, no AI labeling, no visible moderation, on
world-readable public URLs. In the EU that breaches right-of-publicity, defamation exposure, and Article 50 labeling
at once. Axessplayer's pitch line: the same generative-roast engine, but every character consented, every frame
C2PA-signed and Article 50-labeled, brand-safe and EU-legal. They demonstrate the exact liability the trust layer
removes.

### CI10. Multi-scene stitching is their break point, and ours too. (A reliability differentiator.) [Certain from logs]
Repeated failures in the logs: "Error generating scene for story", "An error occurred while processing video files"
immediately after "Combining 2 scene videos", "Oh no, there was an error generating the video", and character
validation friction. Combination is fragile for them. Axessplayer just shipped a continuous-episode stitch pipeline
(commit 1f1dd0e), so stitch reliability is a place to be measurably better IF FLF chaining and consistency QA hold.
Treat stitch robustness as a deliberate differentiator, not an afterthought.

### CI11. The co-creation sandbox attracts tinkerers, not a mass audience. (A caution, do not pivot to it.) [Likely]
About 89 scenes in three months, clustered on a handful of power users, sparse by June. The comedy that lands is
human-written; AI auto-continuations are flowery filler ("explore the layered dynamic of strategy, caution, and
subtle confrontation"). The system stages and renders well but does not write well unsupervised. Lesson: an
AI-video-in-Discord UGC model is clever tech with thin engagement. Take the structured authoring and the
persistent-universe-plus-remix loop (with consented original characters), not the bet-the-company UGC model.
Axessplayer's provable lane stays passive adaptive consumption with a real lift number (prompt 27).

## Holywater deep dive (primary source: their AI-production article + FOX-investment company overview, reviewed June 2026)

Holywater's own materials reveal the real moat, which is not the video app. Decision-relevant intelligence:

### CI12. The moat is a text-first demand funnel, not a content app. (Prioritize the demand sensor.) [Certain]
My Passion (e-book platform, 3.2M MAU, 1,000+ serialized titles, 12 in-house books/month, "a powerful data analysis
system that identifies resonant themes and storylines") is the cheap test bed. Then the tell: 30% of My Drama's
video series, including several of its biggest hits, are adapted from My Passion e-books. They test stories cheaply
as text, watch the data, and graduate only winners into expensive video. This is the industrial-scale version of the
pre-production demand sensor (IDILIO's social test; prompt 14). Third appearance of the same mechanism in our CI.
Implication: stop deprioritizing prompt 14. Axessplayer lacks a cheap text or social test bed; add a lightweight
demand-testing layer (text pilot, social cut, or AI trailer) ahead of expensive generation, and pitch it as a
capability, since the leader proves it works.

### CI13. The leader is walking into adaptive territory, publicly. (Validates the thesis, sets a clock.) [Certain]
Holywater states its next goal is "AI to adjust content based on real-time viewer feedback," plus storyboards and
full series script-to-localization in weeks. That is per-viewer/feedback-adaptive content, the Axessplayer core
thesis. De-risks the thesis (the category leader validates it) and raises urgency to reach the lift number first.
They have no consent, accessibility or Article 50 layer; My Muse (fully AI-generated vertical video, target 100
series/month, crime-first) walks straight into Article 50 labeling from August 2026, increasing the exact regulatory
exposure the trust layer removes.

### CI14. Their AI production stack is detailed and at rough parity with ours. (Claim speed parity, add what they lack.) [Likely]
Stated: 10x faster (script from a month to 10 days), specialized AI agents (one analyzes genres/tropes, one drafts
scenes, one tunes dialogue and arcs), novel to key-events to synopsis to script, 20-30 languages in hours, static
image to animated scene VFX in minutes, and a live AI Companion (chat with characters) that drives engagement. This
maps almost 1:1 to the Axessplayer generation engine (writer/showrunner agents, prompt grammar, localization, FLF
image-to-video). Implication: claim production-speed parity in the pitch and add the consistency QA, consent, and
accessibility they do not have. Reconsider pulling AI companions (prompt 16) forward, with the age and consent
gating they visibly lack.

### CI15. They are formidable and well funded. (Pitch honesty: do not claim to out-execute them on AI drama.) [Certain]
100M+ ecosystem users across four apps (My Drama ~7M MAU, FreeBits ad-supported, My Passion e-books, My Muse genAI
video). My Drama: #1 US/European vertical streaming app, launched March 2024, 100+ series, 4-6 new/month, 35
languages, top series 40M+ views, Webby winner, co-productions with named talent. FOX strategic investment (Oct
2025) plus FOX producing 200+ vertical titles over two years; Meta/Google/TikTok reach partnerships; My Muse won two
Gold Tellys and was a Runway AI Film Festival finalist. The honest pitch line: Axessplayer is not a better
Holywater, it is the per-viewer adaptation, accessibility, consent, EU-compliance, and consented-brand-rail layer
Holywater is missing. Their cited market figure (vertical video >14B by 2027; ~60% of Chinese internet users watch)
corroborates category size; keep our conservative 7.8B/2026 number and footnote theirs.

## One-line strategic position

Do not beat Holywater at their flywheel or the labs at their models or Mirriad at computer vision. Adopt their
orchestration posture and payment stack, exploit the generation-time placement advantage, and win on the wedge the
entire competitive field leaves open: accessibility, consent, provenance, and EU-sovereign compliance, owning
content plus audience plus placement plus data in one stack, for the audience nobody else serves.

## Sources (from the competitive-intel pass, June 2026, vendor/secondary unless noted)

Axios, Horizon Capital, Google AI Studio case study, TechCrunch, Tech.eu, Deadline, AdExchanger, Adweek, PR
Newswire, Harmonic, Rembrand and Mirriad primary materials, and Mirriad's FY2024 / H1 2025 financial filings
(financials independently verified; lift and download figures vendor-reported and directional).
