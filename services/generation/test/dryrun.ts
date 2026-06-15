// Dry run of the offline variant pipeline. Takes a fixture beat from the seeded walking-skeleton series,
// runs the pipeline against a REAL Postgres server (embedded-postgres, migrations 0001..0005 + seed) with
// the FAKE media backend behind the cost gate, and prints the schema-valid beat_variants rows plus the
// C2PA manifests the content graph and W9 can consume. Real GPU / model / media calls are MOCKED: this
// dry run never spends. Invoke with: pnpm --filter @axessplayer/generation dryrun. No em dashes.

import { startPg } from "./pgharness.js";
import { PgGenerationDb } from "../src/generationDb.js";
import { runPipeline } from "../src/pipeline.js";
import { FakeMediaBackend } from "../src/backends.js";
import { prewarmBeats, FakeCdnClient } from "../src/cdn.js";
import type { GenerationSpec, SignedManifestHandoff } from "../src/index.js";

const FIX = {
  series: "11111111-1111-1111-1111-111111111111",
  episode: "22222222-2222-2222-2222-222222222222",
  beatBranchPoint: "bbbbbbbb-0000-0000-0000-000000000002",
} as const;

async function main(): Promise<void> {
  const handle = await startPg();
  try {
    const db = new PgGenerationDb(handle.pool);
    const spec: GenerationSpec = {
      spec_id: "dryrun-001",
      beat: {
        id: FIX.beatBranchPoint,
        series_id: FIX.series,
        episode_id: FIX.episode,
        role: "spine",
        source_url: "https://cdn.example/spine/branch.mov",
        duration_ms: 42000,
      },
      variants: [
        { kind: "dubbing", tier: "A_filmed", language: "es" },
        { kind: "captions", tier: "A_filmed", language: "es" },
        { kind: "audio_description", tier: "A_filmed", language: "en" },
        { kind: "sign", tier: "A_filmed", language: "en", accessibility: { sign: "ase" } },
        { kind: "intensity", tier: "B_likeness", intensity: 5 },
        { kind: "pov", tier: "C_ai", pov: "antagonist", is_premium: true, coin_cost: 5 },
      ],
    };

    const res = await runPipeline(spec, { db, media: new FakeMediaBackend() });

    // The handoff W8 gives W9: one signed-manifest record per produced variant.
    const handoff: SignedManifestHandoff[] = res.produced.map((p) => ({
      beat_variant_id: p.row.id,
      tier: p.row.tier,
      manifest: p.manifest,
    }));

    // Pre-warm the CDN for the servable variants before launch.
    const cdn = new FakeCdnClient();
    const warm = await prewarmBeats([FIX.beatBranchPoint], db, cdn);

    const summary = {
      spec_id: res.spec_id,
      beat_id: res.beat_id,
      produced: res.produced.length,
      passed: res.passed,
      rejected: res.rejected,
      rows: res.produced.map((p) => ({
        id: p.row.id,
        kind: p.manifest.variant_kind,
        language: p.row.language,
        tier: p.row.tier,
        intensity: p.row.intensity,
        pov: p.row.pov,
        accessibility: p.row.accessibility,
        is_premium: p.row.is_premium,
        coin_cost: p.row.coin_cost,
        qa_status: p.row.qa_status,
        playback_url: p.row.playback_url,
      })),
      manifests_for_w9: handoff.length,
      cdn_warmed: warm.warmed.length,
      cost_gate: "closed (fake media backend, zero spend)",
    };

    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  } finally {
    await handle.stop();
  }
}

main().catch((e) => {
  process.stderr.write(String(e instanceof Error ? e.stack : e) + "\n");
  process.exit(1);
});
