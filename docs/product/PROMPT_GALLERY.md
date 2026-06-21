# REELM Prompt Gallery and Cross-Provider Prompting Best Practices

The world's best video-generation output is mostly a prompting problem. This is the sourced, distilled
playbook the REELM agents apply automatically and the team/creators can browse. It is implemented in code as
`services/generation/src/promptcraft.ts` (the grammar + per-provider formatters), `promptGallery.ts` (styles +
verbatim examples), and served live at `GET /gallery`. No em dashes anywhere by project rule.

## How it is wired

- One **structured shot spec** (`ShotPromptSpec`: subject, action, scene, shot, camera, lighting, mood, style,
  dialogue, sfx, ambient, negative, aspect, preset) is the provider-agnostic intermediate.
- `formatPrompt(spec, provider)` renders that spec into the **house idiom of the target model**. The
  Cinematographer agent (`planShots` -> `formatShot`) calls it for whichever model the router picks, so a
  creator never memorizes five rule sets.
- A **gallery style** (e.g. `anime-noir`) carries its style line, a camera bias, and the look-correct negative.
  Critical rule baked in: the famous LTX negative `pc game, console game, video game, cartoon, childish, ugly`
  is **photoreal-only**; an animated style must never carry `cartoon`/`childish` or it fights its own look. Each
  animated style ships its own quality-only negative.

A shot is `<=7s` (the LTX stable window). A 90s episode is `~15-18` such shots, stitched. Length is an
assembly property, not a model property.

## The cross-provider grammar

| Slot | Meaning |
|---|---|
| subject | main character/focal point + a fixed, identical-every-shot descriptor |
| action | present-tense, what visibly happens (the only required slot) |
| scene | setting / environment / context |
| shot | framing + scale (medium close, low angle) |
| camera | movement (slow push-in); on Higgsfield this is a preset, not text |
| lighting / mood | light logic and emotional tone via visual cues, never labels |
| style | the look line (from a gallery style) |
| dialogue / sfx / ambient | native-audio cues (quoted dialogue + "(no subtitles)", `SFX:`, `Ambient noise:`) |
| negative | unwanted items; handling differs per provider (see below) |

## Per-provider house rules (sourced)

### LTX-2.3 (primary animated renderer)
One flowing **present-tense paragraph**, 4-8 sentences: shot, scene + lighting, subject + action, camera,
dialogue (in quotes), audio. Native joint audio; LipDub re-syncs animated mouths per language. Avoid on-screen
text/logos, complex physics, overloaded scenes. Has a real **negative field**. Up to ~20s/call, stable to
~5-8s, 24/25 fps, 9:16.
Source: https://docs.ltx.video/open-source-model/usage-guides/prompting-guide

### Seedance 2.0
`Subject + Action + Scene + Camera + Lighting + Style`. **Multi-shot** by labeling `Shot 1:` / `Shot 2:` (keep
the subject noun identical across beats). Lock a static POV by stating what the camera is **not** doing
(Seedance defaults to cutting). First+last frame (`end_image_url`) and `@Image1/@Video1` reference packs lock
character. Native locked-sync audio. No separate negative field. 4-15s, 720p, 9:16, ~24fps.
Sources: https://fal.ai/learn/devs/seedance-1-5-prompt-guide , https://fal.ai/learn/tools/how-to-use-seedance-2-0

### Veo 3 / 3.1
`[Cinematography] + [Subject] + [Action] + [Context] + [Style & Ambiance]`. Native audio always on:
**quote dialogue with a speaker** and append `(no subtitles)` to suppress burned-in text; label `SFX:` and
`Ambient noise:`. **Negatives go in a separate comma list, never as "no"/"don't" in the positive prompt.**
4/6/8s (8s for 1080p/4K), 720p default, 16:9 & 9:16, 24fps, SynthID watermark.
Sources: https://deepmind.google/models/veo/prompt-guide/ , https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1 , https://ai.google.dev/gemini-api/docs/video

### Runway Gen-4
Text-to-video formula: **`[camera movement]: [establishing scene]. [additional details].`** Image-to-video:
describe **only the motion**, not the image. **No negative phrasing at all** (it may do the opposite). No
abstract/conceptual language; translate ideas into concrete physical actions. 5/10s, 24fps, 720p (upscale 4K),
16:9 / 9:16 / 1:1.
Sources: https://help.runwayml.com/hc/en-us/articles/30586818553107-Gen-3-Alpha-Prompting-Guide , https://help.runwayml.com/hc/en-us/articles/39789879462419-Gen-4-Video-Prompting-Guide , https://runwayml.com/research/introducing-gen-3-alpha

### Higgsfield
**Preset + prompt**: a named camera-motion preset owns the move (Crash Zoom, Bullet Time, FPV Drone, 360 Orbit,
Dolly, Snorricam, ...); the text prompt describes the subject + what happens **during** the move. One camera
move per clip. Reference named cinematographers/directors for the look. ~3-5s, social vertical 9:16. No
negative field; resolution varies by backing model.
Sources: https://higgsfield.ai/camera-controls , https://higgsfield.ai/blog/Prompt-Guide-to-Cinematic-AI-Videos

### Showrunner (narrative scaffolding)
A short **synopsis + per-scene major events** expands into N scenes (each = location + cast + per-character
dialogue), title generated first then dialogue, with **dramatic operators** (reversals, foreshadowing,
cliffhangers) injected at the act/scene level for a real beginning-middle-end. REELM's Writer agent uses these
operators (`DRAMATIC_OPERATORS` in promptcraft.ts) and the content graph for cross-episode canon.
Source: https://fablestudio.github.io/showrunner-agents/

## The launch styles

Each is `id` -> style line + look-correct negative + camera bias (see `GALLERY_STYLES`):
`anime-noir`, `neon-cyberpunk`, `claymation`, `painterly-storybook`, `retro-80s-film`, `photoreal-cinematic`,
`pixel-8bit`, `comic-cel`. Animated styles never carry the photoreal `cartoon/childish` negative.

## Verbatim exemplars

`GALLERY_EXAMPLES` holds source-cited, verbatim example prompts from each provider's own docs/research (frog
yoga studio and live-news oil strike for LTX; the 80s office worker, canyon crane reveal, and bus-window
close-up for Veo; the rainforest formula shot and FPV underwater street for Runway; the golden-retriever beach
track and courtroom closing for Seedance; the POV hook and bittersweet kitchen close-up for Higgsfield). These
double as few-shot seeds the Writer agent can imitate. Every entry carries its provenance URL.

## Using it

- Creators: `GET /gallery` -> pick a style; the Studio shows the style line + examples.
- Agents: `POST /script { premise, provider, styleId }` returns a full script_json where **every shot already
  carries a best-practice, style-applied prompt** for the chosen renderer (+ the right negative / Higgsfield
  preset). The renderer sends `shot.prompt` (and `shot.negativePrompt`) verbatim.
- Pricing/model ids in the registry remain FLAGGED placeholders; re-verify per provider before real spend.
