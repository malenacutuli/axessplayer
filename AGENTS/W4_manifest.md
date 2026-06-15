# W4 Manifest service agent brief

**Mission.** Implement `/manifest/{variant_id}.m3u8`: a pure function of one variant id that returns a
seamless HLS playlist for that beat variant. This is the delivery primitive the player stitches into a
per-viewer cut. No em dashes.

**Branch.** `w4-manifest`, off main. Merge by PR with orchestrator sign-off.

**Owns.** `services/manifest/src/**`, `services/manifest/test/**`, `services/manifest/package.json`,
`tsconfig.json`.

**Consumes (read-only).**
- `contracts/api/manifest.yaml` (frozen, 0.3.1): path `/manifest/{variant_id}.m3u8`, the `200` HLS
  playlist response, the `404 variant_not_found` error. Note there is no session id by design (PF-6).
- Schema `beat_variants` (frozen): `playback_url`, `duration_ms`, codec/tier metadata.

**Must not touch.** `contracts/`, `supabase/migrations/`, other services.

**Build.**
1. Resolve `variant_id` to its `beat_variants` row; 404 if missing.
2. Emit a valid CMAF/LL-HLS media playlist for that variant, with independently decodable segment
   boundaries so the player can switch at a branch point with no gap.
3. Adaptive bitrate variants per beat where available; a default-cut fallback for low bandwidth.
4. Cache headers tuned so the CDN caches at the SEGMENT (shared variant) granularity, never per viewer.
   The manifest itself is cheap to regenerate; the media bytes are the shared, cacheable asset.
5. Keep it stateless and horizontally scalable.

**Definition of done.** Typecheck + lint clean; tests green; FULL `pnpm test` green. The response is a
spec-valid HLS playlist, validated by a parser in a test. Matches `manifest.yaml` exactly.

**Tests.** A known `variant_id` returns a parseable playlist with the expected segments; an unknown id
returns 404; cache headers assert segment-level caching. `node:test` + tsx.

**Flag, do not fake.** If real transcoded segments are not available yet, serve against fixture segment
URLs from the seed and say so. Do not claim seamless switching works without the W5 player to prove it;
your job is the manifest, the switch is W5.
