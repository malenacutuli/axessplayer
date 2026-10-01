// Dashboard data: reads HOSTED data through the EXISTING content/studio client only (GET /admin/overview +
// GET /feed). It does NOT add to or call the 5 live services beyond what the studio client already exposes.
// The aggregates (series counts, variant coverage, ledger coins, decisions) come straight from the live
// schema; we derive at-a-glance KPIs from them. Counterfactual lift is rendered elsewhere as a BAND, never a
// point. No em dashes.
import { useEffect, useState } from "react";
import { useContentClient } from "./useContentClient.js";
import type { AdminOverview, FeedSeries } from "./client.js";

export interface DashboardData {
  overview: AdminOverview;
  feed: FeedSeries[];
}

export type DashboardState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: DashboardData };

export function useDashboard(reloadToken = 0): DashboardState {
  const client = useContentClient();
  const [state, setState] = useState<DashboardState>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    Promise.all([client.getCreatorOverview(), client.getFeed()])
      .then(([overview, feed]) => {
        if (alive) setState({ status: "loaded", data: { overview, feed } });
      })
      .catch((e: unknown) => {
        if (alive)
          setState({ status: "error", message: e instanceof Error ? e.message : "dashboard_load_failed" });
      });
    return () => {
      alive = false;
    };
  }, [client, reloadToken]);

  return state;
}

// A coverage rate (0..1) for a given accessibility track across all variants. Used for the next-best-action
// surface (e.g. "captions cover 62% of variants"). Guards divide-by-zero on an empty catalog.
export function coverageRate(overview: AdminOverview, key: "withCaptions" | "withAudioDescription" | "withSign" | "withDub"): number {
  const total = overview.variants.total;
  if (total <= 0) return 0;
  return overview.variants[key] / total;
}
