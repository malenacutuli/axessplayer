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

## Status

- Phase 1 demo: sign PiP + automated text-to-gloss ASL track on the sample clip (build-sign.mjs + gloss
  manifest), repositionable, SL-named, graceful absence. DONE.
- Richer text-to-sign: sltAI sign-language-translator (Apache-2.0, pip) gives a larger lexicon and a real
  text-to-gloss-to-video engine; it pulls torch plus a downloadable dictionary, so it is a gated heavier
  install to wire on request (the current generator needs no extra dependencies).
- Multi-language sign selection: UI panel in place (ASL); a `sign_video_urls` map (per sign language) is the
  small 0009a extension to add when a second sign language is produced (raise as a proposal, like dubs).
- Phase 2: Deaf-led lexicons + automation. Roadmap, gated on hiring + data ownership.
