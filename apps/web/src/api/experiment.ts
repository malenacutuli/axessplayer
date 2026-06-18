// 25-D2 decision/experiment plane client (viewer side). The creator publishes a poster SET per series
// (candidates tagged by emotion / character / language); the experiment service serves ONE poster per
// viewer from that set, chosen by learned behavior (a CTR bandit on poster SELECTION only, never a
// revenue or wellbeing objective). This client binds to the experiment service (base from
// VITE_EXPERIMENT_BASE_URL, dev proxy /experiment) through the shared apiFetch so the F1 trust boundary
// holds: identity is the session bearer token, never a body field.
//
// HARD GATES honored here:
// - The bandit selection is a PRESENTATION choice (which poster art to show), nothing else.
// - The ACCESSIBILITY-FIRST variant is always eligible; when the viewer has a relevant accessibility
//   preference set, the caller honors that variant over the bandit pick (see resolvePosterSelection).
// - Every served poster logs an impression + a click with the session/viewer unit and a propensity, so
//   the bandit can learn. Logging is best-effort and NEVER blocks render (fire-and-forget, swallowed).
//
// Reachability: when the service is unreachable or the set is empty, selection resolves to null and the
// caller falls back to the existing series.poster_url with NO layout shift and NO dead end. No em dashes.

import { apiFetch, ApiError } from "./http.js";
import type { SessionProvider } from "./session.js";

export { ApiError };

// One candidate poster from the creator's set. `accessibilityFirst` flags the variant that is always
// present and always eligible; when the viewer signals an accessibility preference the caller honors it.
export interface PosterCandidate {
  posterId: string;
  url: string | null;
  // Tags the creator attached to the candidate (emotion / character / language). Opaque to the client.
  tags?: string[];
  accessibilityFirst?: boolean;
}

// The service's per-viewer pick. `posterId` + `url` identify the served art; `propensity` is the
// selection probability the bandit assigned (logged with the impression/click so learning stays
// unbiased). `candidates` is optional and lets the caller honor the accessibility-first variant locally.
export interface PosterSelection {
  posterId: string;
  url: string | null;
  propensity?: number;
  accessibilityFirst?: boolean;
  candidates?: PosterCandidate[];
}

export interface PosterEventBody {
  seriesId: string;
  posterId: string;
  // The session or viewer unit the selection was served to (the same unit passed to /poster/select).
  unit: string;
  // The selection probability, carried through so impressions/clicks stay propensity-weighted.
  propensity?: number;
}

export interface ExperimentClient {
  // GET /poster/select?set=<seriesId>&unit=<viewerOrSession>. Returns null when the service is
  // unreachable or the set is empty, so the caller falls back to the existing poster gracefully.
  selectPoster(seriesId: string, unit: string): Promise<PosterSelection | null>;
  // POST /poster/impression. Best-effort: resolves quietly even on failure, never throws into render.
  logImpression(body: PosterEventBody): Promise<void>;
  // POST /poster/click. Best-effort: resolves quietly even on failure, never throws into render.
  logClick(body: PosterEventBody): Promise<void>;
}

export interface ExperimentClientOptions {
  baseUrl: string;
  session: SessionProvider;
  fetch?: typeof globalThis.fetch;
}

// Normalize a sparse / partial service response into a PosterSelection, or null when there is nothing
// servable (no poster id, or an explicitly empty set). The caller treats null as "use the fallback".
function normalizeSelection(raw: unknown): PosterSelection | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const posterId = typeof r.posterId === "string" ? r.posterId : typeof r.poster_id === "string" ? r.poster_id : null;
  if (!posterId) return null;
  const url = typeof r.url === "string" ? r.url : null;
  const propensity = typeof r.propensity === "number" ? r.propensity : undefined;
  const accessibilityFirst =
    r.accessibilityFirst === true || r.accessibility_first === true || undefined;
  const candidates = Array.isArray(r.candidates)
    ? (r.candidates as unknown[]).map(normalizeCandidate).filter((c): c is PosterCandidate => c !== null)
    : undefined;
  return { posterId, url, propensity, accessibilityFirst, candidates };
}

function normalizeCandidate(raw: unknown): PosterCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const posterId = typeof r.posterId === "string" ? r.posterId : typeof r.poster_id === "string" ? r.poster_id : null;
  if (!posterId) return null;
  return {
    posterId,
    url: typeof r.url === "string" ? r.url : null,
    tags: Array.isArray(r.tags) ? (r.tags.filter((t) => typeof t === "string") as string[]) : undefined,
    accessibilityFirst: r.accessibilityFirst === true || r.accessibility_first === true || undefined,
  };
}

export function createExperimentClient(opts: ExperimentClientOptions): ExperimentClient {
  const { baseUrl, session } = opts;
  return {
    async selectPoster(seriesId: string, unit: string): Promise<PosterSelection | null> {
      // No base url configured -> no experiment plane in this environment. Resolve to the fallback.
      if (!baseUrl) return null;
      try {
        const raw = await apiFetch<unknown>(
          baseUrl,
          `/poster/select?set=${encodeURIComponent(seriesId)}&unit=${encodeURIComponent(unit)}`,
          session,
          { fetch: opts.fetch },
        );
        return normalizeSelection(raw);
      } catch {
        // Unreachable / non-2xx -> graceful fallback to the existing poster. Never surfaces in the UI.
        return null;
      }
    },
    async logImpression(body: PosterEventBody): Promise<void> {
      if (!baseUrl) return;
      try {
        await apiFetch<unknown>(baseUrl, "/poster/impression", session, {
          method: "POST",
          body,
          fetch: opts.fetch,
        });
      } catch {
        // Best-effort: a failed log must never block or surface in the UI.
      }
    },
    async logClick(body: PosterEventBody): Promise<void> {
      if (!baseUrl) return;
      try {
        await apiFetch<unknown>(baseUrl, "/poster/click", session, {
          method: "POST",
          body,
          fetch: opts.fetch,
        });
      } catch {
        // Best-effort: a failed log must never block or surface in the UI.
      }
    },
  };
}
