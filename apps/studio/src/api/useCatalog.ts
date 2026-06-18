// Load the catalog graph view or the series analytics, with idle/loading/loaded/error states and a reload
// token. A 404 from the catalog service (the additive routes are not deployed in every environment) is
// surfaced as a distinct "not_available" message so the sections can render a graceful, non-dead-end empty
// state instead of a scary error. No em dashes.
import { useCallback, useEffect, useState } from "react";
import { useCatalogClient } from "./useCatalogClient.js";
import { CatalogApiError } from "./catalogClient.js";
import type { SeriesGraphView, SeriesAnalytics, SeriesRevenue } from "./catalogTypes.js";

export type CatalogState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; data: T }
  | { status: "error"; message: string; notAvailable: boolean };

function useCatalogResource<T>(seriesId: string, reloadToken: number, fetcher: (id: string) => Promise<T>): CatalogState<T> {
  const [state, setState] = useState<CatalogState<T>>({ status: "idle" });

  const load = useCallback(async () => {
    if (!seriesId) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    try {
      const data = await fetcher(seriesId);
      setState({ status: "loaded", data });
    } catch (e) {
      const notAvailable = e instanceof CatalogApiError && (e.status === 404 || e.status === 501);
      const message = notAvailable
        ? "not_available"
        : e instanceof Error
          ? e.message
          : "load_failed";
      setState({ status: "error", message, notAvailable });
    }
  }, [seriesId, fetcher]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  return state;
}

export function useSeriesGraphView(seriesId: string, reloadToken: number): CatalogState<SeriesGraphView> {
  const client = useCatalogClient();
  const fetcher = useCallback((id: string) => client.getSeriesGraph(id), [client]);
  return useCatalogResource(seriesId, reloadToken, fetcher);
}

export function useSeriesAnalytics(seriesId: string, reloadToken: number): CatalogState<SeriesAnalytics> {
  const client = useCatalogClient();
  const fetcher = useCallback((id: string) => client.getSeriesAnalytics(id), [client]);
  return useCatalogResource(seriesId, reloadToken, fetcher);
}

export function useSeriesRevenue(seriesId: string, reloadToken: number): CatalogState<SeriesRevenue> {
  const client = useCatalogClient();
  const fetcher = useCallback((id: string) => client.getSeriesRevenue(id), [client]);
  return useCatalogResource(seriesId, reloadToken, fetcher);
}
