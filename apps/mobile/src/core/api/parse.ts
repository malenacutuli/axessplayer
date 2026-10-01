// Defensive parsers for the content responses. The service is being built in parallel, so a missing or
// mistyped field must not crash a screen: a video that lacks the required identity fields (id, title) is
// dropped, every optional field degrades to a safe default, and the accessibility block defaults to
// "nothing provided" rather than guessing. No em dashes.

import type {
  HomeFeed,
  HomeRow,
  Orientation,
  Playback,
  ShortsPage,
  Sponsor,
  Video,
  VideoAccessibility,
  VideoFormat,
} from "./types";

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function orientationOf(v: unknown, width: number | null, height: number | null): Orientation {
  if (v === "vertical" || v === "horizontal" || v === "square") return v;
  if (width && height) {
    if (width === height) return "square";
    return height > width ? "vertical" : "horizontal";
  }
  return "horizontal";
}

function formatOf(v: unknown, orientation: Orientation): VideoFormat {
  if (v === "short" || v === "long") return v;
  return orientation === "vertical" ? "short" : "long";
}

function parseAccessibility(v: unknown): VideoAccessibility {
  const a = isObj(v) ? v : {};
  const dubs = Array.isArray(a.dubs) ? a.dubs.filter((d): d is string => typeof d === "string" && d.length > 0) : [];
  return {
    captions: a.captions === true,
    audio_description: a.audio_description === true,
    sign: a.sign === true,
    dubs,
  };
}

function parseSponsor(v: unknown): Sponsor | null {
  if (!isObj(v)) return null;
  const brand = str(v.brand);
  if (!brand) return null;
  return { brand, disclosure: str(v.disclosure) ?? `Paid partnership with ${brand}` };
}

export function parseVideo(v: unknown): Video | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  const title = str(v.title);
  if (!id || !title) return null;
  const ch = isObj(v.channel) ? v.channel : {};
  const width = num(v.width);
  const height = num(v.height);
  const orientation = orientationOf(v.orientation, width, height);
  return {
    id,
    title,
    description: str(v.description),
    channel: { id: str(ch.id) ?? "", name: str(ch.name) ?? "Unknown channel" },
    orientation,
    width,
    height,
    duration_ms: num(v.duration_ms),
    format: formatOf(v.format, orientation),
    language: str(v.language) ?? "und",
    category: str(v.category),
    thumbnail_url: str(v.thumbnail_url),
    published_at: str(v.published_at) ?? "",
    accessibility: parseAccessibility(v.accessibility),
    sponsor: parseSponsor(v.sponsor),
  };
}

function parseVideos(v: unknown): Video[] {
  if (!Array.isArray(v)) return [];
  const out: Video[] = [];
  for (const raw of v) {
    const video = parseVideo(raw);
    if (video) out.push(video);
  }
  return out;
}

export function parseShortsPage(v: unknown): ShortsPage {
  const o = isObj(v) ? v : {};
  return { items: parseVideos(o.items), next_cursor: str(o.next_cursor) };
}

export function parseHomeFeed(v: unknown): HomeFeed {
  const o = isObj(v) ? v : {};
  const rows: HomeRow[] = [];
  if (Array.isArray(o.rows)) {
    for (const r of o.rows) {
      if (!isObj(r)) continue;
      const id = str(r.id);
      const title = str(r.title);
      const items = parseVideos(r.items);
      if (!id || !title || items.length === 0) continue;
      rows.push({ id, title, items });
    }
  }
  return { rows };
}

export function parsePlayback(v: unknown): Playback | null {
  if (!isObj(v)) return null;
  const url = str(v.playback_url);
  return url ? { playback_url: url } : null;
}
