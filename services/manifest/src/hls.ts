// Pure HLS playlist construction. No I/O, no state, so it is trivially horizontally scalable and unit
// testable. We emit two playlist kinds:
//   1. a media playlist for one rendition (independently decodable CMAF segments), and
//   2. a multivariant (master) playlist that lists ABR renditions plus the default-cut fallback.
// Reference: RFC 8216 (HLS) and the LL-HLS additions. No em dashes.

import type { BeatVariantRow, RenditionRow } from "./db.js";

// Target CMAF segment duration. Independently decodable boundaries (each segment starts on an IDR/keyframe)
// are what let the W5 player switch at a branch point with no gap. The switch itself is proven by W5, not here.
export const TARGET_SEGMENT_SECONDS = 4;

const HLS_VERSION = 7; // 7+ is required for fMP4 (CMAF) segments via EXT-X-MAP.

function segmentBaseUrl(playbackUrl: string): string {
  // The playback_url points at the rendition's own media playlist (e.g. .../calm.m3u8). Segments live
  // beside it. We derive a base by stripping the trailing playlist filename. This keeps segment URLs on
  // the shared, cacheable path so the CDN caches bytes per variant, never per viewer.
  const slash = playbackUrl.lastIndexOf("/");
  return slash >= 0 ? playbackUrl.slice(0, slash + 1) : "";
}

// Stable segment file stem derived from the rendition playlist name, so two viewers requesting the same
// variant hit identical segment URLs (shared cache key).
function segmentStem(playbackUrl: string): string {
  const slash = playbackUrl.lastIndexOf("/");
  const name = slash >= 0 ? playbackUrl.slice(slash + 1) : playbackUrl;
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(0, dot) : name;
}

function splitDurations(totalSeconds: number, target: number): number[] {
  if (totalSeconds <= 0) return [target];
  const out: number[] = [];
  let remaining = totalSeconds;
  while (remaining > target + 1e-9) {
    out.push(target);
    remaining -= target;
  }
  // Round the tail to milliseconds to keep EXTINF tidy and within the EXT-X-TARGETDURATION ceiling.
  out.push(Math.round(remaining * 1000) / 1000);
  return out;
}

// Build a single-rendition media playlist. durationMs may be null (schema allows it); we fall back to one
// target-length segment so the playlist still parses while real transcodes are pending.
export function buildMediaPlaylist(playbackUrl: string, durationMs: number | null): string {
  const totalSeconds = durationMs != null && durationMs > 0 ? durationMs / 1000 : TARGET_SEGMENT_SECONDS;
  const durations = splitDurations(totalSeconds, TARGET_SEGMENT_SECONDS);
  const base = segmentBaseUrl(playbackUrl);
  const stem = segmentStem(playbackUrl);
  const targetDuration = Math.ceil(Math.max(...durations));

  const lines: string[] = [
    "#EXTM3U",
    `#EXT-X-VERSION:${HLS_VERSION}`,
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    // Every segment begins on a keyframe, so each is independently decodable. This is the contract the
    // player relies on to splice at a branch boundary with no gap.
    "#EXT-X-INDEPENDENT-SEGMENTS",
    // CMAF initialization segment (fMP4). Shared across all media segments of this rendition.
    `#EXT-X-MAP:URI="${base}${stem}_init.mp4"`,
  ];

  durations.forEach((d, i) => {
    lines.push(`#EXTINF:${d.toFixed(3)},`);
    lines.push(`${base}${stem}_${i}.m4s`);
  });

  lines.push("#EXT-X-ENDLIST");
  return lines.join("\n") + "\n";
}

// Build a multivariant (master) playlist for a variant that has an ABR ladder. The default-cut rendition
// is emitted first so a low-bandwidth client picks it up immediately. Each EXT-X-STREAM-INF points at the
// rendition's own media playlist URL.
export function buildMasterPlaylist(renditions: RenditionRow[]): string {
  // Default-cut (lowest bandwidth) first, then ascending bandwidth, for predictable low-bandwidth start.
  const ordered = [...renditions].sort((a, b) => {
    if (a.is_default && !b.is_default) return -1;
    if (b.is_default && !a.is_default) return 1;
    return a.bandwidth - b.bandwidth;
  });

  const lines: string[] = [
    "#EXTM3U",
    `#EXT-X-VERSION:${HLS_VERSION}`,
    "#EXT-X-INDEPENDENT-SEGMENTS",
  ];

  for (const r of ordered) {
    const attrs = [`BANDWIDTH=${r.bandwidth}`];
    if (r.resolution) attrs.push(`RESOLUTION=${r.resolution}`);
    if (r.codecs) attrs.push(`CODECS="${r.codecs}"`);
    lines.push(`#EXT-X-STREAM-INF:${attrs.join(",")}`);
    lines.push(r.playback_url);
  }

  return lines.join("\n") + "\n";
}

// Top-level builder. If the variant has an ABR ladder, return a master playlist; otherwise a single-
// rendition media playlist for the variant's own playback_url.
export function buildPlaylist(variant: BeatVariantRow, renditions: RenditionRow[]): string {
  if (renditions.length > 0) return buildMasterPlaylist(renditions);
  return buildMediaPlaylist(variant.playback_url, variant.duration_ms);
}
