// Data access for the manifest service. The handler is a pure function of one variant_id, so the only
// dependency is a read of the beat_variants row (frozen schema 0001). The interface is injected so the
// handler is testable without a live Supabase, and so the real edge worker can swap in the service client.
// No em dashes.

// Subset of the frozen beat_variants columns the manifest service reads. The full table lives in
// supabase/migrations/0001_init.sql and is owned by W0; we only depend on these fields.
export interface BeatVariantRow {
  id: string;
  beat_id: string;
  language: string;
  // tier: A_filmed | B_likeness | C_ai. Drives the rendition label only; not authority.
  tier: string;
  playback_url: string;
  // duration_ms is nullable in the schema. When absent we fall back to a conservative default so the
  // playlist still parses; the bytes are the source of truth once real transcodes exist.
  duration_ms: number | null;
}

// Adaptive-bitrate renditions for a single variant. Sibling rows in beat_variants under the same beat,
// or transcode ladders of the same source. The default-cut fallback is the lowest-bandwidth rendition,
// served when the client signals low bandwidth or no ABR data is available.
export interface RenditionRow {
  // Bandwidth in bits per second, as required by the EXT-X-STREAM-INF BANDWIDTH attribute.
  bandwidth: number;
  // Approximate resolution, e.g. "1280x720". Optional; emitted as RESOLUTION when present.
  resolution?: string;
  // Codec string for CODECS, e.g. "avc1.4d401f,mp4a.40.2". Optional.
  codecs?: string;
  playback_url: string;
  // Marks the conservative default-cut fallback rendition for low bandwidth.
  is_default?: boolean;
}

export interface ManifestDB {
  // Resolve a variant_id to its beat_variants row, or null if there is no such variant.
  getVariant(variantId: string): Promise<BeatVariantRow | null>;
  // ABR renditions for the variant, lowest-bandwidth first. Empty when only a single rendition exists,
  // in which case the handler emits a plain media playlist for the variant's own playback_url.
  getRenditions(variantId: string): Promise<RenditionRow[]>;
}

// In-memory fake seeded from the walking-skeleton fixtures (supabase/seed.sql). Used by the tests and as
// the local stand-in until the real Supabase service client is wired. This is a STUB: the playback_url
// values are fixture placeholders, not real transcoded CMAF segments.
export class InMemoryManifestDB implements ManifestDB {
  private variants = new Map<string, BeatVariantRow>();
  private renditions = new Map<string, RenditionRow[]>();

  constructor(rows: BeatVariantRow[], renditions: Record<string, RenditionRow[]> = {}) {
    for (const row of rows) this.variants.set(row.id, row);
    for (const [id, list] of Object.entries(renditions)) this.renditions.set(id, list);
  }

  async getVariant(variantId: string): Promise<BeatVariantRow | null> {
    return this.variants.get(variantId) ?? null;
  }

  async getRenditions(variantId: string): Promise<RenditionRow[]> {
    return this.renditions.get(variantId) ?? [];
  }
}

// Fixture rows mirroring supabase/seed.sql beat_variants. Placeholder playback_urls (flagged as stubbed).
export const FIXTURE_VARIANTS: BeatVariantRow[] = [
  { id: "cccccccc-0000-0000-0000-000000000001", beat_id: "bbbbbbbb-0000-0000-0000-000000000001", language: "en", tier: "A_filmed", playback_url: "https://cdn.example/skel/coldopen.m3u8", duration_ms: 12000 },
  { id: "cccccccc-0000-0000-0000-000000000002", beat_id: "bbbbbbbb-0000-0000-0000-000000000002", language: "en", tier: "A_filmed", playback_url: "https://cdn.example/skel/branchpoint.m3u8", duration_ms: 8000 },
  { id: "cccccccc-0000-0000-0000-00000000000a", beat_id: "bbbbbbbb-0000-0000-0000-00000000000a", language: "en", tier: "A_filmed", playback_url: "https://cdn.example/skel/calm.m3u8", duration_ms: 15000 },
  { id: "cccccccc-0000-0000-0000-00000000000b", beat_id: "bbbbbbbb-0000-0000-0000-00000000000b", language: "en", tier: "A_filmed", playback_url: "https://cdn.example/skel/tense.m3u8", duration_ms: 15000 },
  { id: "cccccccc-0000-0000-0000-000000000004", beat_id: "bbbbbbbb-0000-0000-0000-000000000004", language: "en", tier: "A_filmed", playback_url: "https://cdn.example/skel/ending.m3u8", duration_ms: 20000 },
  { id: "cccccccc-0000-0000-0000-000000000005", beat_id: "bbbbbbbb-0000-0000-0000-000000000004", language: "en", tier: "A_filmed", playback_url: "https://cdn.example/skel/ending_premium.m3u8", duration_ms: 22000 },
];

// One variant carries an ABR ladder so the multi-rendition (master) path is exercised. The lowest rung
// is the default-cut fallback for low bandwidth. Also stubbed fixture URLs.
export const FIXTURE_RENDITIONS: Record<string, RenditionRow[]> = {
  "cccccccc-0000-0000-0000-00000000000b": [
    { bandwidth: 600000, resolution: "640x360", codecs: "avc1.42c01e,mp4a.40.2", playback_url: "https://cdn.example/skel/tense_360.m3u8", is_default: true },
    { bandwidth: 1500000, resolution: "1280x720", codecs: "avc1.4d401f,mp4a.40.2", playback_url: "https://cdn.example/skel/tense_720.m3u8" },
    { bandwidth: 4500000, resolution: "1920x1080", codecs: "avc1.640028,mp4a.40.2", playback_url: "https://cdn.example/skel/tense_1080.m3u8" },
  ],
};
