// The catalog client: the read + calibration surface that the onboarding cold open (20-V1) and the
// discover surfaces (20-V3) consume. It binds to the CATALOG API CONTRACT (base from
// VITE_CATALOG_BASE_URL), going through the shared apiFetch so the F1 trust boundary holds: identity
// is the session bearer token, never a body field. Every call returns the contract shape; the
// surfaces own their own empty / loading / error states. No em dashes.

import { apiFetch, ApiError } from "./http.js";
import type { SessionProvider } from "./session.js";

export { ApiError };

// ---- POST /calibrate -------------------------------------------------------
export type CalibratePace = "slow_burn" | "tense";

export interface CalibrateBody {
  pace: CalibratePace;
  // The point of view the viewer chose (free-form id from the cold-open question set).
  pov: string;
  // 0..1 intensity preference. Writes into viewer_state.preference_vector server-side.
  intensity: number;
}

export interface CalibrateResult {
  // Human-readable payoff summary, e.g. "slow burn, your POV, English, we tuned the pacing to you".
  summary: string;
  // The badge label, contract value is "CUT FOR YOU".
  badge: string;
}

// ---- GET /continue ---------------------------------------------------------
export interface ContinueItem {
  seriesId: string;
  title: string;
  poster: string | null;
  beatId: string;
  // 0..1 watch progress.
  progress: number;
}

// ---- GET /trending ---------------------------------------------------------
export interface TrendingItem {
  seriesId: string;
  title: string;
  poster: string | null;
  genre: string | null;
}

// ---- GET /series/:id/detail ------------------------------------------------
export interface SeriesA11y {
  cc: boolean;
  ad: boolean;
  sign: boolean;
  // Number of available languages.
  langs: number;
}

export interface SeriesEpisode {
  id: string;
  number: number;
  coinCost: number;
  locked: boolean;
}

export interface SeriesDetail {
  hero: string | null;
  genre: string | null;
  format: string | null;
  episodeCount: number;
  endingsCount: number;
  a11y: SeriesA11y;
  episodes: SeriesEpisode[];
  // Title is not in the strict contract column list but the merchandising hero needs it; the catalog
  // service returns it alongside hero. Optional so a contract that omits it still typechecks.
  title?: string;
}

// ---- GET /search?q= --------------------------------------------------------
export interface SearchShow {
  seriesId: string;
  title: string;
  poster: string | null;
  genre: string | null;
}
export interface SearchCharacter {
  id: string;
  name: string;
  seriesId: string;
  seriesTitle?: string;
}
export interface SearchChannel {
  id: string;
  name: string;
}
export interface SearchResults {
  shows: SearchShow[];
  characters: SearchCharacter[];
  channels: SearchChannel[];
}

export interface CatalogClient {
  calibrate(body: CalibrateBody): Promise<CalibrateResult>;
  getContinue(): Promise<ContinueItem[]>;
  getTrending(): Promise<TrendingItem[]>;
  getSeriesDetail(seriesId: string): Promise<SeriesDetail>;
  search(q: string): Promise<SearchResults>;
}

export interface CatalogClientOptions {
  baseUrl: string;
  session: SessionProvider;
  fetch?: typeof globalThis.fetch;
}

export function createCatalogClient(opts: CatalogClientOptions): CatalogClient {
  const { baseUrl, session } = opts;
  return {
    async calibrate(body: CalibrateBody): Promise<CalibrateResult> {
      return apiFetch<CalibrateResult>(baseUrl, "/calibrate", session, {
        method: "POST",
        body,
        fetch: opts.fetch,
      });
    },
    async getContinue(): Promise<ContinueItem[]> {
      const raw = await apiFetch<ContinueItem[] | { items: ContinueItem[] }>(
        baseUrl,
        "/continue",
        session,
        { fetch: opts.fetch },
      );
      return Array.isArray(raw) ? raw : (raw.items ?? []);
    },
    async getTrending(): Promise<TrendingItem[]> {
      const raw = await apiFetch<TrendingItem[] | { items: TrendingItem[] }>(
        baseUrl,
        "/trending",
        session,
        { fetch: opts.fetch },
      );
      return Array.isArray(raw) ? raw : (raw.items ?? []);
    },
    async getSeriesDetail(seriesId: string): Promise<SeriesDetail> {
      return apiFetch<SeriesDetail>(baseUrl, `/series/${encodeURIComponent(seriesId)}/detail`, session, {
        fetch: opts.fetch,
      });
    },
    async search(q: string): Promise<SearchResults> {
      const raw = await apiFetch<Partial<SearchResults>>(
        baseUrl,
        `/search?q=${encodeURIComponent(q)}`,
        session,
        { fetch: opts.fetch },
      );
      return {
        shows: raw.shows ?? [],
        characters: raw.characters ?? [],
        channels: raw.channels ?? [],
      };
    },
  };
}
