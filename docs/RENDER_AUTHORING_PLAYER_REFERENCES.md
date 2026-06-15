# What we learn from Remotion, Twine, and Kaltura

**Version 1.0 - June 2026 - Axessible Technologies.** Three open-source references, one per layer: Remotion
(programmatic render), Twine (branching authoring), Kaltura PlayKit (HTML5 player). The lead finding is a
LICENSE reality that changes the build. No em dashes.

## 0. License reality (read first - it is a gate, not a footnote)

| Project | License | Posture |
|---|---|---|
| **Kaltura PlayKit JS** | **AGPL-3.0** | DO NOT FORK or link into our proprietary SaaS. AGPL copyleft triggers on network use; shipping a player derived from it could obligate us to release our source. Study the architecture; reimplement as our own code, or engage Kaltura commercially. |
| **Remotion** | **Custom license** | Affordable but a PROCUREMENT step: "requires obtaining a company license in some cases" (likely above a team-size/revenue threshold). Decide deliberately before it becomes load-bearing; do not let it land by accident in a dependency. |
| **Twine** | GPL (editor) | LEARN FREELY. We take UX + data-model ideas, not a fork, so it is a design reference. |

Posture: treat all three as ARCHITECTURE REFERENCES. Copy patterns and API shapes; keep our player,
renderer, and Studio as our own code on permissive dependencies. The only one we might actually depend on is
Remotion (with the company-license decision made on purpose), for offline/Studio rendering, never the AGPL
player. **License review before dependency** is a hard gate (see PRODUCTION_CUTOVER_CHECKLIST).

## 1. Remotion -> Studio publish-time render and assembly (offline only)

Video as a function of frames; a `<Composition>` (width/height/fps/durationInFrames) renders to MP4 via
Node; the killer property is INPUT PROPS: same composition, different video per props. That is our "one
production, many cuts" thesis at the render layer. Fits:
- Per-viewer/per-market variants = same composition, different props (title cards, localized lower-thirds,
  cliffhanger/end cards with the viewer name, market legal bug).
- The Axess Director editor-agent assembly: captions, branch/cliffhanger cards, transitions, accessible
  caption styling, watermark, C2PA-friendly overlays. AI makes footage; Remotion stitches and brands it
  reproducibly.
- Dynamic product placement compositing: brand asset as an input prop.
- Server-side render is solved on the same primitives we chose (Lambda/Cloud Run/Docker, JSON props file) =
  our render-on-demand-into-per-user-cache.
NOT the answer for: the generative/face-swap work, and never the realtime player. Studio/offline side only.
Action: prototype publish-time assembly as Remotion compositions driven by input props, rendered through a
queued cloud renderer into the variant store. Gate behind the company-license decision first.

## 2. Twine -> Studio branch-graph editor + interchange (LANDED: export)

Take: (a) decouple authoring tool from runtime format - our Studio authors the content graph; the player +
decision engine is the runtime that interprets it; the editor never hardcodes runtime assumptions. (b)
Passages/links map to beats/beat_edges: zoomable node canvas, drag-to-connect, broken-link detection,
per-node outbound choices. (c) a plain-text interchange format is a feature (Twee): a canonical JSON/YAML
export of the content graph for version control, review, and machine emission by the generation pipeline.
Diverge hard from Twine's runtime: it is single-player client-side hypertext; ours is multi-viewer video,
implicit (engine re-cuts) plus explicit (viewer chooses), resolving through `/decide` against `beat_edges`.
Conditional logic lives in the decision engine + canon filter, never in the document.
LANDED 2026-06-15: the Studio Branch editor now exports the authored graph as canonical, diffable JSON
(apps/studio/src/api/graphInterchange.ts: stable ordering, broken-edge detection) via an Export graph
button. Still to build: the full zoomable canvas polish and a re-import path.

## 3. Kaltura PlayKit -> player-sdk architecture (study, do not fork)

Validates our player plan: MSE + EME is the correct foundation (same conclusion as the Eko learnings), and a
THIN CORE + PLUGINS/ADAPTERS architecture fits our feature spread (accessible tracks, the decision/prefetch
hook, paywall, wallet, QoE, placement) - build each as a plugin around a small playback core so
accessibility and adaptive-branch logic evolve independently. One interface over many formats/platforms so
the app and decision engine never branch on browser quirks.
Do NOT follow its license: AGPL-3.0, reimplement the patterns as our own permissive code. Our differentiator
that PlayKit does not have: seamless per-viewer branch switching via prefetch-plus-MSE, driven by the
decision engine. Build it as a first-class core capability.
Action: design `player-sdk` as a small MSE/EME core with a plugin/adapter surface, our own code, with
seamless-branch prefetch as a core capability. (Aligns with EKO_LEARNINGS.md lift #1 and #5.)

## The net

1. Input-props rendering (Remotion) is the cleanest expression of "one production, many cuts" at the render
   layer; reuse the pattern even if we do not take the dependency.
2. Author/runtime decoupling (Twine) keeps the Studio and the decision engine evolving independently; author
   intent + constraints, decide at serve time, never bake runtime into the document.
3. MSE/EME core plus plugins (Kaltura) is the validated player architecture; our seamless-branch prefetch is
   the one capability no general player has. Reimplement, do not absorb the AGPL source.

Governing gate: LICENSE REVIEW BEFORE DEPENDENCY. Remotion = procurement decision; PlayKit = do-not-fork;
Twine = safe to learn from.

## Sources

Remotion docs (fundamentals, SSR) + README license note; Twine (twinejs) README + story formats; Kaltura
PlayKit JS (AGPL-3.0).
