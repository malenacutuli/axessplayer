// CDN origin pre-warm. Before a title goes live, the offline pipeline asks the CDN to pull every servable
// (qa_status = passed) variant into origin / edge cache so the first viewers do not stampede a cold
// origin. Only passed variants are warmed: a pending or rejected variant must never be fetched, because it
// must never serve. The actual CDN purge / prefetch call is an injected port; tests use a fake that
// records what it was asked to warm. No em dashes.

import type { VariantRow } from "./spec.js";
import { isServable } from "./qa.js";
import type { GenerationDB } from "./generationDb.js";

export interface PrewarmTarget {
  variant_id: string;
  playback_url: string;
}

// The CDN client port. A real implementation issues prefetch / cache-warm requests against the CDN
// management API. The fake records the targets.
export interface CdnClient {
  warm(targets: PrewarmTarget[]): Promise<void>;
}

export class FakeCdnClient implements CdnClient {
  public readonly warmed: PrewarmTarget[] = [];
  async warm(targets: PrewarmTarget[]): Promise<void> {
    for (const t of targets) this.warmed.push(t);
  }
}

export interface PrewarmResult {
  warmed: PrewarmTarget[];
  skipped_non_servable: number; // count of rows filtered out because they were not passed
}

// Pre-warm a set of beats: gather their passed variants and warm the CDN for each. A defensive
// isServable filter guards against a caller passing rows that are not actually passed.
export async function prewarmBeats(
  beatIds: string[],
  db: GenerationDB,
  cdn: CdnClient
): Promise<PrewarmResult> {
  const targets: PrewarmTarget[] = [];
  let skipped = 0;
  for (const beatId of beatIds) {
    const variants = await db.listPassedVariantsForBeat(beatId);
    for (const v of variants) {
      if (!isServable(v.qa_status)) {
        skipped++;
        continue;
      }
      targets.push({ variant_id: v.id, playback_url: v.playback_url });
    }
  }
  await cdn.warm(targets);
  return { warmed: targets, skipped_non_servable: skipped };
}

// Warm an explicit list of rows (for example the rows a single pipeline run just promoted). Filters out
// anything not servable so a cold pending / rejected url is never prefetched.
export async function prewarmRows(rows: VariantRow[], cdn: CdnClient): Promise<PrewarmResult> {
  const targets: PrewarmTarget[] = [];
  let skipped = 0;
  for (const v of rows) {
    if (!isServable(v.qa_status)) {
      skipped++;
      continue;
    }
    targets.push({ variant_id: v.id, playback_url: v.playback_url });
  }
  await cdn.warm(targets);
  return { warmed: targets, skipped_non_servable: skipped };
}
