// Shorts feed paging and the playback window policy. The feed is a vertical pager: exactly one item
// plays (the visible one), the next one is preloaded (player created and buffering, paused), the
// previous one stays mounted paused so a swipe back is instant, and everything else is released to keep
// memory flat. Paging requests the next cursor when the viewer is within `threshold` items of the end.
// No em dashes.

import type { ShortsPage, Video } from "../api/types";

export interface ShortsState {
  items: Video[];
  cursor: string | null;
  // True once the server returned next_cursor = null.
  done: boolean;
  loading: boolean;
  // Set when the endpoint is unavailable (404) or failed, for the empty state copy.
  error: "unavailable" | "failed" | null;
}

export const initialShortsState: ShortsState = { items: [], cursor: null, done: false, loading: false, error: null };

// Merge a page, dropping duplicates (a cursor race or a server re-rank can repeat an id).
export function appendPage(state: ShortsState, page: ShortsPage): ShortsState {
  const seen = new Set(state.items.map((v) => v.id));
  const fresh = page.items.filter((v) => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
  return {
    items: [...state.items, ...fresh],
    cursor: page.next_cursor,
    done: page.next_cursor === null,
    loading: false,
    error: null,
  };
}

export function shouldLoadMore(state: ShortsState, activeIndex: number, threshold = 2): boolean {
  if (state.loading || state.done || state.error) return false;
  if (state.items.length === 0) return true;
  return activeIndex >= state.items.length - 1 - threshold;
}

export interface PlaybackWindow {
  active: number;
  preload: number[];
  mounted: number[];
}

export function playbackWindow(activeIndex: number, length: number, ahead = 1, behind = 1): PlaybackWindow {
  if (length <= 0) return { active: -1, preload: [], mounted: [] };
  const active = Math.min(Math.max(0, activeIndex), length - 1);
  const preload: number[] = [];
  for (let i = 1; i <= ahead; i++) if (active + i < length) preload.push(active + i);
  const mounted: number[] = [];
  for (let i = Math.max(0, active - behind); i <= Math.min(length - 1, active + ahead); i++) mounted.push(i);
  return { active, preload, mounted };
}

export type ItemRole = "active" | "preload" | "mounted" | "released";

export function roleOf(index: number, w: PlaybackWindow): ItemRole {
  if (index === w.active) return "active";
  if (w.preload.includes(index)) return "preload";
  if (w.mounted.includes(index)) return "mounted";
  return "released";
}

// The index whose page is most visible, from a scroll offset (pagingEnabled snaps to whole pages).
export function indexFromOffset(offsetY: number, pageHeight: number, length: number): number {
  if (pageHeight <= 0 || length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, Math.round(offsetY / pageHeight)));
}
