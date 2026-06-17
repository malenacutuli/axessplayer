// P5-T3 feature store + P5-T4 separability (CORRECTIONS C5). The recommender ranks WHAT series to surface
// in the feed. It trains on ENGAGEMENT signals only. The re-cutter's cut-selection signals
// (served_variant_id, propensity, is_control, policy_version) are DELIBERATELY excluded: mixing the two
// streams contaminates attribution, so a future experiment could not isolate the effect of the cut. The
// duration-debiased watch fraction (not raw watch_ms) is used so the ranker is not biased toward long
// content (D2Q, Kuaishou). No em dashes.

// The only signals the recommender may consume. A reviewer checks new features against this allow-list.
export const RECOMMENDER_ENGAGEMENT_SIGNALS = ["viewer_id", "series_id", "completion", "watch_ms", "duration_ms", "returned"] as const;
// Signals that belong to the re-cutter and must NEVER enter the recommender (C5 firewall).
export const RECUTTER_ONLY_SIGNALS = ["served_variant_id", "propensity", "is_control", "policy_version"] as const;

// One engagement observation (a viewer watched a series). No cut-selection fields by construction.
export type EngagementRow = {
  viewerId: string;
  seriesId: string;
  completion: number; // 0..1
  watchMs: number;
  durationMs: number;
  returned: boolean; // came back within the return window
};

export type ViewerFeatures = { viewerId: string; vector: number[] };
export type ItemFeatures = { seriesId: string; vector: number[] };

// Duration-debiased watch fraction (D2Q): watch time as a fraction of duration, capped at 1, so a long
// title is not rewarded merely for being long. Raw watch_ms is never used as a signal.
export function debiasedWatchFraction(watchMs: number, durationMs: number): number {
  if (!(durationMs > 0)) return 0;
  const f = watchMs / durationMs;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

// C5 firewall: throw if any feature key is a re-cutter-only signal. Called by the store when ingesting a
// feature spec, so a contaminating signal fails loudly in tests rather than silently biasing the model.
export function assertNoRecutterSignal(featureKeys: string[]): void {
  const banned = featureKeys.filter((k) => (RECUTTER_ONLY_SIGNALS as readonly string[]).includes(k));
  if (banned.length > 0) {
    throw new Error(`recommender C5 firewall: re-cutter signal(s) not allowed as recommender features: ${banned.join(", ")}`);
  }
}

// Viewer features from their engagement history: [meanCompletion, meanDebiasedWatch, returnRate, activity].
// activity is a normalized log of the view count (recency/volume), in [0,1].
export function viewerFeatures(viewerId: string, rows: EngagementRow[]): ViewerFeatures {
  const mine = rows.filter((r) => r.viewerId === viewerId);
  const activity = Math.min(1, Math.log1p(mine.length) / Math.log1p(50));
  return {
    viewerId,
    vector: [
      mean(mine.map((r) => r.completion)),
      mean(mine.map((r) => debiasedWatchFraction(r.watchMs, r.durationMs))),
      mine.length ? mine.filter((r) => r.returned).length / mine.length : 0,
      activity,
    ],
  };
}

// Item features from engagement across all viewers: [avgCompletion, avgDebiasedWatch, returnRate, popularity].
export function itemFeatures(seriesId: string, rows: EngagementRow[]): ItemFeatures {
  const its = rows.filter((r) => r.seriesId === seriesId);
  const popularity = Math.min(1, Math.log1p(new Set(its.map((r) => r.viewerId)).size) / Math.log1p(1000));
  return {
    seriesId,
    vector: [
      mean(its.map((r) => r.completion)),
      mean(its.map((r) => debiasedWatchFraction(r.watchMs, r.durationMs))),
      its.length ? its.filter((r) => r.returned).length / its.length : 0,
      popularity,
    ],
  };
}

export const FEATURE_DIM = 4;

export interface FeatureStore {
  viewer(viewerId: string): ViewerFeatures;
  item(seriesId: string): ItemFeatures;
  allItems(): ItemFeatures[];
}

// In-memory store built from an engagement log. A production store reads the engagement_events warehouse
// (mobile.engagement_events), NOT decision_log (the cut stream), preserving the C5 firewall.
export class InMemoryFeatureStore implements FeatureStore {
  constructor(private readonly rows: EngagementRow[]) {}
  viewer(viewerId: string): ViewerFeatures {
    return viewerFeatures(viewerId, this.rows);
  }
  item(seriesId: string): ItemFeatures {
    return itemFeatures(seriesId, this.rows);
  }
  allItems(): ItemFeatures[] {
    return [...new Set(this.rows.map((r) => r.seriesId))].map((s) => this.item(s));
  }
}
