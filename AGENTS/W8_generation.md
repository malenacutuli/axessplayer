# W8 Generation pipeline agent brief

**Mission.** The offline pipeline that turns a filmed spine plus a script into the per-viewer variant
library: generate language, accessibility, intensity, and POV variants, QA-gate them, sign them with
C2PA, and publish to CDN origin before a title goes live. This is why the system scales: the expensive
work happens once, offline, amortized across every viewer. No em dashes.

**Branch.** `w8-generation`, off main. Merge by PR with orchestrator sign-off.

**Owns.** `services/generation/src/**`, `services/generation/test/**`, that package's manifest.

**Consumes (read-only schema; writes the variant rows it produces).**
- Schema (frozen): `beats`, `beat_variants` (it produces variant rows with `playback_url`, `tier`,
  `intensity`, `language`, `accessibility`, `coin_cost`, `qa_status`), `content_credentials` (it writes
  the signed manifest per variant; coordinate the provenance write with W7).

**Must not touch.** `contracts/`, `supabase/migrations/`, other services' code.

**Build.**
1. A queue-driven batch job: input a beat and a generation spec, output one or more `beat_variants`
   rows with their media and metadata.
2. Variant kinds: dubbing and captions per language, audio description and sign tracks (accessibility),
   intensity and POV recuts. Reuse the existing media plumbing (timed-text, dubbing, resumable upload)
   where it exists.
3. QA gate: each variant lands `qa_status = pending` and is promoted only after the QA check; rejected
   variants never serve.
4. Provenance: emit the C2PA manifest for each variant for W7 to record in `content_credentials`.
5. Pre-warm CDN origin for a title before launch so the first viewers do not stampede the origin.

**Definition of done.** Typecheck + lint clean; tests green; FULL `pnpm test` green. A dry-run that takes
a fixture beat and produces valid `beat_variants` rows that the content graph and manifest service can
consume.

**Tests.** Pipeline-step unit tests with fake media backends; a job that produces variant rows the
schema accepts (composite integrity, enums, non-negative `coin_cost`). Real model and media calls are
mocked; assert the row shapes and the QA gating, not the AI output quality.

**Flag, do not fake.** GPU generation and third-party model calls are mocked in tests; say so. Do not
publish a variant to a servable state without passing the QA gate.
