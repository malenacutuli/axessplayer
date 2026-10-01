// Short-lived signed HLS urls. The content service returns a playback_url that expires; the cache keeps a
// url only while it is comfortably fresh and forgets it on a playback error (a 403 from the CDN surfaces
// as a player error), so the next load refetches. Expiry comes from an "exp" query parameter (unix
// seconds) when present, otherwise from a conservative default TTL. No em dashes.

export interface CachedUrl {
  url: string;
  expiresAt: number;
}

export const DEFAULT_TTL_MS = 5 * 60 * 1000;
export const SAFETY_MARGIN_MS = 30 * 1000;
export const MAX_PLAYBACK_RETRIES = 2;

export function expiryFromUrl(url: string, fetchedAt: number, defaultTtlMs = DEFAULT_TTL_MS): number {
  const m = /[?&](?:exp|expires|Expires)=(\d{9,13})(?:&|$)/.exec(url);
  if (m) {
    const n = Number(m[1]);
    const ms = n < 1e12 ? n * 1000 : n;
    if (ms > fetchedAt) return ms;
  }
  return fetchedAt + defaultTtlMs;
}

export class PlaybackUrlCache {
  private readonly entries = new Map<string, CachedUrl>();
  constructor(private readonly now: () => number = Date.now) {}

  get(videoId: string): string | null {
    const e = this.entries.get(videoId);
    if (!e) return null;
    if (e.expiresAt - SAFETY_MARGIN_MS <= this.now()) {
      this.entries.delete(videoId);
      return null;
    }
    return e.url;
  }

  set(videoId: string, url: string): void {
    const t = this.now();
    this.entries.set(videoId, { url, expiresAt: expiryFromUrl(url, t) });
  }

  invalidate(videoId: string): void {
    this.entries.delete(videoId);
  }
}

// Fetch a playback url through the cache. forceRefresh skips the cache (used after a player error).
export async function resolvePlaybackUrl(
  cache: PlaybackUrlCache,
  videoId: string,
  fetchUrl: (id: string) => Promise<string | null>,
  forceRefresh = false
): Promise<string | null> {
  if (forceRefresh) cache.invalidate(videoId);
  const hit = cache.get(videoId);
  if (hit) return hit;
  const url = await fetchUrl(videoId);
  if (url) cache.set(videoId, url);
  return url;
}

// After a player error: refetch a fresh url while attempts remain.
export function shouldRetryPlayback(attemptsSoFar: number): boolean {
  return attemptsSoFar < MAX_PLAYBACK_RETRIES;
}
