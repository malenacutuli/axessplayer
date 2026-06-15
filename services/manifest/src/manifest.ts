// /manifest/{variant_id}.m3u8 handler. A pure function of one variant_id (PF-6: no session id). Resolves
// the beat_variants row, 404s when missing, and emits a spec-valid HLS playlist with cache headers tuned
// for SEGMENT-granular CDN caching (the manifest is cheap to regenerate; the media bytes are the shared,
// cacheable asset). Stateless and horizontally scalable. No em dashes.

import type { ManifestDB } from "./db.js";
import { buildPlaylist } from "./hls.js";
import type { components } from "./generated/manifest.js";

// Error body shape is pinned to the generated contract type, so it cannot drift from manifest.yaml.
type ErrorBody = components["schemas"]["Error"];

export const HLS_CONTENT_TYPE = "application/vnd.apple.mpegurl";

// The manifest is cheap to regenerate and must never be cached per viewer, so it carries a short,
// shareable TTL. The media segments (referenced by the manifest, served by the CDN from the shared
// variant path) get a long immutable TTL: that is where the cache value lives.
export const MANIFEST_CACHE_CONTROL = "public, max-age=60, s-maxage=60";
export const SEGMENT_CACHE_CONTROL = "public, max-age=31536000, immutable";

export interface ManifestResult {
  status: 200 | 404;
  contentType: string;
  body: string;
  headers: Record<string, string>;
}

function ok(body: string): ManifestResult {
  return {
    status: 200,
    contentType: HLS_CONTENT_TYPE,
    body,
    headers: {
      "Content-Type": HLS_CONTENT_TYPE,
      // Manifest TTL: short and shared, never keyed to a viewer.
      "Cache-Control": MANIFEST_CACHE_CONTROL,
      // Advertise the cache policy the CDN must apply to the media SEGMENTS this manifest references.
      // Segments are the shared variant asset and are cached at segment granularity, never per viewer.
      "X-Segment-Cache-Control": SEGMENT_CACHE_CONTROL,
      // No session id by design (PF-6), so nothing here varies per viewer. Vary on nothing viewer
      // specific keeps every viewer of the same variant on one cache entry.
      Vary: "Accept-Encoding",
    },
  };
}

function notFound(): ManifestResult {
  const body: ErrorBody = { error: "variant_not_found" };
  return {
    status: 404,
    contentType: "application/json",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  };
}

export async function handleManifest(variantId: string, db: ManifestDB): Promise<ManifestResult> {
  const variant = await db.getVariant(variantId);
  if (!variant) return notFound();
  const renditions = await db.getRenditions(variantId);
  const playlist = buildPlaylist(variant, renditions);
  return ok(playlist);
}
