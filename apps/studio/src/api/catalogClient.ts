// Catalog service fetch client for the studio. A small typed wrapper over fetch with a configurable base
// URL (VITE_CATALOG_BASE_URL, same-origin default so the dev proxy can forward /catalog by prefix) and a
// session-authed creator bearer token. The studio only READS the two additive routes:
//   GET /series/:id/graph
//   GET /series/:id/analytics
// Like the content client, this NEVER sends a user_id in a body (these are GETs, so it is not in play). No
// em dashes.

import type { SeriesGraphView, SeriesAnalytics } from "./catalogTypes.js";

export class CatalogApiError extends Error {
  readonly status: number;
  readonly apiError?: string;
  constructor(status: number, apiError?: string) {
    super(apiError ? `catalog_api_error:${status}:${apiError}` : `catalog_api_error:${status}`);
    this.name = "CatalogApiError";
    this.status = status;
    this.apiError = apiError;
  }
}

export type FetchLike = typeof fetch;

export interface CatalogClientOptions {
  baseUrl: string;
  // The session-authed creator token (session:<uuid>). Sent as a bearer on every request. Optional so a
  // dev/proxy deployment that injects the header upstream can omit it.
  token?: string | null;
  fetchImpl?: FetchLike;
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}${path}`;
}

export class CatalogClient {
  private readonly baseUrl: string;
  private readonly token: string | null;
  private readonly fetchImpl: FetchLike;

  constructor(opts: CatalogClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.token = opts.token ?? null;
    // Bind the global fetch to its receiver (the browser fetch is unforgeable and throws on a detached call).
    // Tests inject fetchImpl, so this branch only runs in the browser.
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  // GET /series/:id/graph : the authored branch graph (nodes/edges/memoryVars/canon/pricing).
  async getSeriesGraph(seriesId: string): Promise<SeriesGraphView> {
    return this.get<SeriesGraphView>(`/series/${encodeURIComponent(seriesId)}/graph`);
  }

  // GET /series/:id/analytics : per-series retention / branch perf / endings / funnel / cohorts.
  async getSeriesAnalytics(seriesId: string): Promise<SeriesAnalytics> {
    return this.get<SeriesAnalytics>(`/series/${encodeURIComponent(seriesId)}/analytics`);
  }

  private async get<T>(path: string): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await this.fetchImpl(joinUrl(this.baseUrl, path), { method: "GET", headers });
    let json: unknown = undefined;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const apiError = (json as { error?: string } | undefined)?.error;
      throw new CatalogApiError(res.status, apiError);
    }
    return json as T;
  }
}
