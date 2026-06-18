// Content service fetch client for the studio. One small typed wrapper over fetch with a configurable
// base URL (see ./config.ts). Reads bind to the generated content types where the contract is concrete;
// writes use the mirrored bodies from ./contractGap.ts until the content.yaml enrichment lands.
//
// F1 GUARDRAIL: this client NEVER sends a `user_id` in any request body. The content authoring API takes
// no actor id. As defence in depth, sendJson strips a `user_id` key if one is ever passed in, so no caller
// (form, test, future code) can leak one. No em dashes.

import type { paths, operations } from "@axessplayer/contracts/content";
import type {
  CreateSeriesBody,
  UpdateSeriesBody,
  CreateEpisodeBody,
  CreateBeatBody,
  CreateVariantBody,
  CreateEdgeBody,
  SeriesRow,
  EpisodeRow,
  BeatRow,
  VariantRow,
  EdgeRow,
  SeriesGraph,
  ApiError,
} from "./contractGap.js";
import { flattenGraph, type FlatGraph } from "./flattenGraph.js";

// CONTRACT BINDING (reads): assert the documented graph route and its path-param type exist in the
// codegen. These types are compile-time only; if content.yaml drops or renames the route or the {id}
// param, this breaks the studio typecheck. When the 200 body schema is added to the contract, swap
// SeriesGraph for the codegen 200 type here and in ./contractGap.ts.
type GraphRoute = paths["/series/{id}/graph"]["get"];
export type GraphIdParam = operations["getSeriesGraph"]["parameters"]["path"]["id"];
// Compile-time only: forces GraphRoute to resolve. Unused at runtime by design.
export type _GraphRouteBound = GraphRoute extends never ? never : true;

export class ContentApiError extends Error {
  readonly status: number;
  readonly apiError?: string;
  constructor(status: number, apiError?: string) {
    super(apiError ? `content_api_error:${status}:${apiError}` : `content_api_error:${status}`);
    this.name = "ContentApiError";
    this.status = status;
    this.apiError = apiError;
  }
}

export type FetchLike = typeof fetch;

// A published series as GET /feed returns it (newest first).
export interface FeedSeries {
  id: string;
  title: string;
  genre: string | null;
  cover_url: string | null;
  poster_url: string | null;
  published_at: string;
}

// Operator dashboard aggregates returned by GET /admin/overview (mirrors the content service shape).
export interface AdminOverview {
  series: { published: number; total: number };
  variants: {
    total: number;
    premium: number;
    qaPassed: number;
    withCaptions: number;
    withAudioDescription: number;
    withSign: number;
    withDub: number;
  };
  ledger: {
    transactions: number;
    coinsGranted: number;
    coinsSpent: number;
    byType: Array<{ type: string; count: number; coins: number }>;
    wallets: number;
    walletBalance: number;
  };
  decisions: number;
}

export interface ContentClientOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}${path}`;
}

export class ContentClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: ContentClientOptions) {
    this.baseUrl = opts.baseUrl;
    // Bind the global fetch to its receiver. A bare `fetch` reference is detached, and the browser's
    // fetch is unforgeable: an unbound call throws "Failed to execute 'fetch' on 'Window': Illegal
    // invocation". Tests inject fetchImpl, so this branch only runs in the browser.
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  // GET /series/{id}/graph : the raw NESTED graph as the service returns it.
  async getSeriesGraph(seriesId: GraphIdParam): Promise<SeriesGraph> {
    const res = await this.fetchImpl(
      joinUrl(this.baseUrl, `/series/${encodeURIComponent(seriesId)}/graph`),
      { method: "GET", headers: { accept: "application/json" } },
    );
    return this.parse<SeriesGraph>(res);
  }

  // GET /series/{id}/graph, FLATTENED at the client boundary: beats and variants are lifted out of the
  // tree and beat_id is re-stamped onto every variant (the nested response omits it). Every studio surface
  // consumes this flat shape, so the consumer-app nested-graph bug cannot recur here.
  async getFlatGraph(seriesId: GraphIdParam): Promise<FlatGraph> {
    return flattenGraph(await this.getSeriesGraph(seriesId));
  }

  // POST /series/{id}/produce : start the Simple-mode auto-produce job for the whole series (the ingestion
  // factory fans out transcript/poster/captions/AD/sign/dub across the chosen targets). Returns the job id +
  // the stage plan so the processing view can track it.
  async produceSeries(
    id: string,
    targets: { languages: string[]; tracks: string[]; signLanguages: string[]; tier: string },
  ): Promise<{ jobId: string; stageCount: number; estimatedUsd: number }> {
    const res = await this.fetchImpl(joinUrl(this.baseUrl, `/series/${encodeURIComponent(id)}/produce`), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(targets),
    });
    return this.parse(res);
  }

  // GET /feed : the real published series (newest first), so the Library lists what is actually in the
  // schema instead of a hardcoded seed id. Empty when nothing is published.
  async getFeed(): Promise<FeedSeries[]> {
    const res = await this.fetchImpl(joinUrl(this.baseUrl, "/feed"), {
      method: "GET",
      headers: { accept: "application/json" },
    });
    const body = await this.parse<{ series?: FeedSeries[] }>(res);
    return body.series ?? [];
  }

  // GET /admin/overview : read-only operator aggregates (content + ledger + decisions) from the live schema.
  async getAdminOverview(): Promise<AdminOverview> {
    const res = await this.fetchImpl(joinUrl(this.baseUrl, "/admin/overview"), {
      method: "GET",
      headers: { accept: "application/json" },
    });
    return this.parse<AdminOverview>(res);
  }

  createSeries(body: CreateSeriesBody): Promise<SeriesRow> {
    return this.sendJson<SeriesRow>("/series", body);
  }
  // GET /series : ALL series incl drafts (newest first). The studio picker uses this, not /feed, so the
  // creator sees unpublished work they are still building.
  async listAllSeries(): Promise<SeriesRow[]> {
    const res = await this.fetchImpl(joinUrl(this.baseUrl, "/series"), {
      method: "GET",
      headers: { accept: "application/json" },
    });
    const body = await this.parse<{ series?: SeriesRow[] }>(res);
    return body.series ?? [];
  }
  // PATCH /series/{id} : rename / update series metadata. Only the fields present in the body change.
  async updateSeries(id: string, body: UpdateSeriesBody): Promise<SeriesRow> {
    const safeBody = stripUserId(body);
    const res = await this.fetchImpl(joinUrl(this.baseUrl, `/series/${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(safeBody),
    });
    return this.parse<SeriesRow>(res);
  }
  createEpisode(body: CreateEpisodeBody): Promise<EpisodeRow> {
    return this.sendJson<EpisodeRow>("/episodes", body);
  }
  createBeat(body: CreateBeatBody): Promise<BeatRow> {
    return this.sendJson<BeatRow>("/beats", body);
  }
  createVariant(body: CreateVariantBody): Promise<VariantRow> {
    return this.sendJson<VariantRow>("/variants", body);
  }
  createEdge(body: CreateEdgeBody): Promise<EdgeRow> {
    return this.sendJson<EdgeRow>("/edges", body);
  }
  // DELETE /variants/{id} : remove a beat_variant. Resolves on 200, throws ContentApiError on 4xx (e.g. a 404
  // variant_not_found). No body, so F1 (no user_id) is not in play here.
  async deleteVariant(id: string): Promise<{ id: string; deleted: true }> {
    const res = await this.fetchImpl(joinUrl(this.baseUrl, `/variants/${encodeURIComponent(id)}`), {
      method: "DELETE",
      headers: { accept: "application/json" },
    });
    return this.parse<{ id: string; deleted: true }>(res);
  }

  // POST /series/{id}/publish | /unpublish (0009b) : flip publish state. No body.
  async publishSeries(id: string): Promise<{ id: string; published_at: string | null }> {
    const res = await this.fetchImpl(joinUrl(this.baseUrl, `/series/${encodeURIComponent(id)}/publish`), {
      method: "POST",
      headers: { accept: "application/json" },
    });
    return this.parse(res);
  }
  async unpublishSeries(id: string): Promise<{ id: string; published_at: string | null }> {
    const res = await this.fetchImpl(joinUrl(this.baseUrl, `/series/${encodeURIComponent(id)}/unpublish`), {
      method: "POST",
      headers: { accept: "application/json" },
    });
    return this.parse(res);
  }

  // POST /series/{id}/poster/generate : server-side generate (stability-ai) -> upload -> persist
  // series.poster_url with C2PA + Article 50 provenance. The generation key never reaches the browser.
  async generateSeriesPoster(id: string, prompt: string): Promise<{ id: string; poster_url: string }> {
    const res = await this.fetchImpl(joinUrl(this.baseUrl, `/series/${encodeURIComponent(id)}/poster/generate`), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ prompt }),
    });
    return this.parse<{ id: string; poster_url: string }>(res);
  }

  // PATCH /series/{id}/poster (0009c) : store the chosen generated poster URL + C2PA provenance.
  async setSeriesPoster(
    id: string,
    body: { poster_url: string; provenance?: Record<string, unknown> },
  ): Promise<{ id: string; poster_url: string }> {
    const res = await this.fetchImpl(joinUrl(this.baseUrl, `/series/${encodeURIComponent(id)}/poster`), {
      method: "PATCH",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(stripUserId(body)),
    });
    return this.parse(res);
  }

  // Post a JSON body and parse the 201/4xx. F1: strip any stray user_id before it can be sent.
  private async sendJson<T>(path: string, body: unknown): Promise<T> {
    const safeBody = stripUserId(body);
    const res = await this.fetchImpl(joinUrl(this.baseUrl, path), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(safeBody),
    });
    return this.parse<T>(res);
  }

  private async parse<T>(res: Response): Promise<T> {
    let json: unknown = undefined;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const apiError = (json as ApiError | undefined)?.error;
      throw new ContentApiError(res.status, apiError);
    }
    return json as T;
  }
}

// F1 defence in depth: remove a user_id key from an object body so the studio can never send an actor id.
export function stripUserId(body: unknown): unknown {
  if (body == null || typeof body !== "object" || Array.isArray(body)) return body;
  if (!("user_id" in body)) return body;
  const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  delete clone.user_id;
  return clone;
}
