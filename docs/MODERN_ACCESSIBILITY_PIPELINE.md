# Modern accessibility pipeline (captions, AD, dubbing) - local, no external creds

June 2026. Our own engine, evolving past the Axessible (2025) stack. The insight: the differentiated assets can
be produced LOCALLY with current open/system tooling, so a real accessible cut needs no third-party credentials
to demonstrate. No em dashes.

## Stack (what we run, vs Axessible 2025)

| Stage | Axessible 2025 | This engine (local) | Production upgrade |
|---|---|---|---|
| ASR + word timing | Deepgram / AssemblyAI (cloud) | **Whisper** (open SOTA), `--word_timestamps` | WhisperX / Deepgram Nova-3 / Gemini audio |
| Prosody / intensity | AssemblyAI sentiment + Hume prosody (cloud) | **DSP on the PCM**: per-word RMS loudness -> 7-level intensity, autocorrelation F0 -> pitch/width | audio-LLM (Gemini audio, Qwen2-Audio) for emotion vectors |
| Character ID | speaker-diarization-unified (cloud) | **LLM reads the script** and attributes speaker + CI color (reviewed map) | pyannote 3.1 / NeMo diarization + multimodal face-tracking (Gemini 2.5 / GPT-4o vision) |
| AD description | twelve-labs + GPT-4 (cloud) | **LLM authors scene text** from the plot, scheduled in dialogue gaps | vision-LLM scene understanding on the frames |
| TTS (AD + dub) | ElevenLabs (cloud) | **macOS `say`** -> real AD/dub audio, no creds | ElevenLabs v3 / OpenAI tts voice cloning + lipsync |
| Translation (dub) | cloud MT | LLM translation | same, with glossary + register control |

## Captions with intention - DONE, real, wired

`tools/accessibility-pipeline/build-captions.mjs`:
1. Whisper produces the word-level transcript (`coldopen.json`).
2. The script reads the 16k mono PCM and computes, per word: RMS loudness (dBFS) and an autocorrelation F0.
3. Loudness z-score -> the 7-level intensity (whisper..screaming); F0 vs median -> pitch (low/normal/high) ->
   the font width axis. ALL-CAPS + high z -> screaming.
4. Character attribution assigns each segment a speaker + CI palette color (Strawberry red, Banana yellow,
   Grape purple, Apple green).
5. Emits the `CaptionSegment[]` document the vertical `CaptionsWithIntention` renderer consumes, attached to the
   variant via `PATCH /variants/{id}/tracks` (0009a).

Result on the cold open: 44 segments, 303 words, a real dynamic range (148 normal, 59 loud, 39 quiet, 30
whisper, 15 yelling, 12 screaming), synced to the real audio. Not a mockup.

## Audio description - next, local path proven

- Dialogue GAPS come straight from the Whisper segment boundaries (the EAD `computeGaps` lifted from Axessible
  `lib/ad/scheduler.ts`).
- Scene text authored by the LLM from the plot (or a vision-LLM in production), one line per gap.
- `say -v Samantha -o ad.aiff "..."` -> ffmpeg aac -> a real AD audio track (proven: 5.3s sample generated).
- Player: an AD `<audio>` element plays each segment at its startTime and DUCKS the video dialogue volume;
  honors `requiresExtension` (pause / slowdown) for gaps too short. Schema: `AudioDescriptionSegment` lifted
  from Axessible `types/audioDescription.ts`. Attached via `audio_description_url` (0009a).

## Dubbing - next, local path proven

- Translate the transcript per language (LLM), `say -v <locale voice>` -> dub audio (proven: ES sample 7.8s).
- Player: a dub `<audio>` element replaces the original dialogue for the selected language; per-language map in
  `dub_audio_urls` (0009a). The screenshot's "No content available for dubbing" becomes a populated dub map.

## Why this matters

Every differentiated track (captions-with-intention, creative AD, multi-language dub) can be produced and shown
WITHOUT third-party credentials, using Whisper + DSP + system TTS. Cloud upgrades (Nova-3, Gemini vision,
ElevenLabs, lipsync) are drop-in quality bumps behind the same 0009a seams, gated on the founder's keys.
