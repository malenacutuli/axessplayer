# Sign language program (multi-language)

June 2026. Two strictly separated phases. Honest about scale, licensing, and linguistics. No em dashes.

## Phase 1: the demo (built)

The vertical sign-language PiP plays a sign track in the 9:16 player: viewport-relative size, repositionable
(left/right) and resizable, positioned to clear captions, faces, and the right action rail, with graceful
absence when no track exists. Driven for the demo by a dialogue-aligned ASL track built from real per-word
clips on the sample cold-open. No "prototype" wording in the UI; the PiP shows the sign short name (ASL) as a badge.

- Sign track attached via 0009a `sign_video_url`; the toggle is the generic "Sign language" (SL).
- A sign-language selection panel sits under the toggle and lists the sign languages produced for the title
  (ASL now); it grows as we add BSL and others. The toggle reflects real availability (disabled when absent).
- Real per-word dictionary, extracted from open sources. `tools/accessibility-pipeline/download-asl-dict.mjs`
  reads the WLASL v0.3 gloss index, and for every content word in the cut's transcript downloads a real ASL
  clip from the reachable direct hosts (signstock/SignSchool, files.startasl.com, aslbricks.org), validates it
  is genuine video, trims to the WLASL frame range, and normalizes it to a uniform 480x640 vertical clip.
  Yield on the sample: 89 real word clips (no, yes, money, time, today, forgive, dead, kill, lie, secret, boss,
  insurance, and the fruit characters apple/banana/grapes/strawberry).
- `tools/accessibility-pipeline/build-sign.mjs` then runs text-to-gloss over the transcript and concatenates
  the matched real clips in dialogue order (a short neutral hold between each), writing `asl_gloss.json` so each
  sign maps back to its spoken word. The sample track is 150 real signs from 153 matched words.
- Honest caveats: the clips come from DIFFERENT signers (one performer per word, framing varies), the track is
  concatenative ASL gloss (not full ASL grammar or non-manual markers), and because each isolated sign runs
  about two seconds the track is longer than the spoken audio and is NOT time-synced to it. It loops in the PiP.
  Word-accurate, time-synced, single-signer output is the production path below (pose engine, Deaf-led Phase 2).
  Operator handles source-clip licensing separately; the WLASL sources are research/non-commercial.
- A caution learned the hard way: an earlier "isolated-sign dictionary" in the asset folder turned out to be
  17 byte-identical copies of a placeholder photo (not signs at all). Any concatenative text-to-gloss track is
  only as real as its dictionary; verify every source clip is genuine signing before wiring it.

## The ten languages (named correctly)

ASL (American), BSL (British), LSE (Lengua de Signos Espanola), LSM (Lengua de Senas Mexicana), an Arabic Sign
Language variant (pick one first: Egyptian, Levantine, Gulf, or the pan-Arab register), Indian Sign Language
(Indo-Pakistani), Turk Isaret Dili (Turkish), Israeli Sign Language, Chinese Sign Language, and a Portuguese
target to confirm: LGP (Portugal) vs Libras (Brazil) - Libras has far more open data and a larger market.

Naming flags: "ISL" collides across Indian / Israeli / Irish, so always use the full name; "Portuguese" must be
pinned to LGP or Libras. Each sign language is a distinct language with its own grammar, lexicon, and non-manual
grammar (facial expressions and mouth morphemes that carry meaning). Ten languages is ten parallel Deaf-led
programs, not one pipeline with a language switch. Sequence them.

## Architecture (clone the permissive engine, own the data)

One pipeline, language-agnostic in code, language-specific in data:

spoken text -> text-to-gloss (per spoken-language NLP) -> gloss -> lexicon lookup -> pose sequence -> blend ->
render to sign video -> attach to the variant (0009a `sign_video_url`) -> vertical PiP plays it.

Clone the PERMISSIVELY-licensed libraries only (verify each LICENSE before use): spoken-to-signed-translation
(MIT), pose / pose-format (MIT), sltAI sign-language-translator (Apache-2.0), spaCy + per-language models (MIT).
Do NOT clone the sign.mt / sign-translate app (CC BY-NC-SA 4.0); we have our own player and Studio. Take the
libraries, not the application.

## Phase 2: production (roadmap, not built)

For real episodes: hire Deaf signers per language, build our own consented sign lexicons (sovereign, CH/EU),
and grow text-to-gloss-to-pose-to-video automation on data we own, with a Deaf reviewer in the loop. Automation
per language is gated on owning enough lexicon for that language. The honest scale: the demo is weeks; one
production-quality language lexicon with Deaf signers and community QA is months; ten is quarters to years.

## Extracted dictionaries (open sources)

The pipeline now extracts real per-word dictionaries from open repositories, normalized to a uniform vertical
clip the sign builder concatenates. Two are wired into the sample:

- ASL: `download-asl-dict.mjs` reads the WLASL v0.3 gloss index and pulls genuine clips from reachable direct
  hosts (signstock/SignSchool, files.startasl.com, aslbricks) with a yt-dlp YouTube fallback
  (player_client=android bypasses YouTube's 403). 760 words committed; resumable to the full ~2000 by re-running
  in ALL mode (skip-existing). Mixed signers (one per word).
- PSL (Pakistan Sign Language): `download-psl-dict.mjs` reads sign-language-translator/sign-language-datasets
  (label->release-video URLs plus a label->English/Urdu/Hindi token map) and builds an English-keyed PSL
  dictionary. Full dictionary: 1252 words, 0 download failures, single academy source (Hamza Foundation), so
  signer and framing are consistent.

Both extractors take a transcript (dialogue-only) or the literal `ALL` (whole vocabulary, deduped by sign).
Clips are stored via git-lfs so the dictionaries do not bloat the repo.

More sources researched, extractable next (download-everything backlog):

- BSL SignBank (UCL, 3688 public BSL signs): a target language; no open API, needs a data request or scraping
  the Signbank app. V-Librasil (Libras, 4089 signs, IEEE DataPort) and MM-WLAuslan (Auslan, 3215 glosses, GitHub)
  are the next two target-language dictionaries with real video.
- MS-ASL (Microsoft, 1000 words / 25k clips): YouTube-hosted, now reachable with the yt-dlp android client.
- ASL Citizen (Microsoft, 2.7k signs / 83k clips): large bulk download, commercial use needs Microsoft contact.
- How2Sign: continuous ASL (80h), for sentence-level alignment rather than a word dictionary.
- sltAI engine (Apache-2.0, pip): a real text-to-gloss-to-video engine for a larger lexicon; pulls torch.

All source clips are research/non-commercial; the operator handles licensing separately.

## Status

- Phase 1 demo: sign PiP + automated text-to-gloss tracks on the sample clip (build-sign.mjs + gloss manifest),
  repositionable, SL-named, graceful absence. DONE.
- Two sign languages produced and selectable: ASL and PSL. The selection panel switches the inset between them.
  Wiring note: 0009a still carries a single `sign_video_url` (the ASL track); the other sign tracks live next to
  it in the same media dir as `<sl>_sign.webm`, and the player derives the sibling URL client-side. The proper
  fix is the `sign_video_urls` map (per sign language) drafted in `docs/proposals/0009d_sign_video_urls.md`,
  to ratify like the dub map before this ships.
- Phase 2: Deaf-led lexicons + automation. Roadmap, gated on hiring + data ownership.
