// Media state for beat variants: the Cloudflare Stream lifecycle (uploading -> ready | error), the lookups
// playback needs (premium flag, draft privacy, owner), and the entitlement check that gates premium cuts.
// One implementation over a pg-shaped query function (production node-postgres, tests PGlite). No em dashes.

import type { Query } from "./ownership.js";

export interface VariantPlayback {
  variantId: string;
  playbackUrl: string;
  isPremium: boolean;
  streamUid: string | null;
  streamHls: string | null;
  streamStatus: string | null;
  seriesPublished: boolean;
  ownerId: string | null;
}

export interface StreamRef {
  uid: string;
  hls: string | null;
  status: string | null;
}

export interface MediaStore {
  setStreamUploading(variantId: string, uid: string): Promise<void>;
  markStreamReady(uid: string, hls: string, durationMs: number | null): Promise<string | null>;
  markStreamError(uid: string): Promise<string | null>;
  playbackOf(variantId: string): Promise<VariantPlayback | null>;
  streamRefsOfSeries(seriesId: string): Promise<Map<string, StreamRef>>;
  hasEntitlement(userId: string, variantId: string): Promise<boolean>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (v == null ? null : String(v));

export function sqlMediaStore(query: Query): MediaStore {
  return {
    async setStreamUploading(variantId, uid) {
      await query("update beat_variants set stream_uid = $2, stream_status = 'uploading' where id = $1", [variantId, uid]);
    },
    // Ready: the cut becomes servable (qa passed) with Stream's manifest URL and duration. Idempotent.
    async markStreamReady(uid, hls, durationMs) {
      const { rows } = await query(
        `update beat_variants set stream_status = 'ready', stream_hls = $2, duration_ms = coalesce($3, duration_ms),
           qa_status = 'passed' where stream_uid = $1 returning id`,
        [uid, hls, durationMs],
      );
      return str(rows[0]?.id);
    },
    async markStreamError(uid) {
      const { rows } = await query(
        "update beat_variants set stream_status = 'error', qa_status = 'rejected' where stream_uid = $1 returning id",
        [uid],
      );
      return str(rows[0]?.id);
    },
    async playbackOf(variantId) {
      if (!UUID_RE.test(variantId)) return null;
      const { rows } = await query(
        `select v.id, v.playback_url, v.is_premium, v.stream_uid, v.stream_hls, v.stream_status,
                (s.published_at is not null) as published, s.owner_id
           from beat_variants v join beats b on b.id = v.beat_id join series s on s.id = b.series_id
          where v.id = $1`,
        [variantId],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        variantId: String(r.id),
        playbackUrl: String(r.playback_url),
        isPremium: r.is_premium === true,
        streamUid: str(r.stream_uid),
        streamHls: str(r.stream_hls),
        streamStatus: str(r.stream_status),
        seriesPublished: r.published === true,
        ownerId: str(r.owner_id),
      };
    },
    async streamRefsOfSeries(seriesId) {
      const out = new Map<string, StreamRef>();
      if (!UUID_RE.test(seriesId)) return out;
      const { rows } = await query(
        `select v.id, v.stream_uid, v.stream_hls, v.stream_status
           from beat_variants v join beats b on b.id = v.beat_id
          where b.series_id = $1 and v.stream_uid is not null`,
        [seriesId],
      );
      for (const r of rows) out.set(String(r.id), { uid: String(r.stream_uid), hls: str(r.stream_hls), status: str(r.stream_status) });
      return out;
    },
    async hasEntitlement(userId, variantId) {
      const { rows } = await query(
        "select 1 from entitlements where user_id = $1 and scope = 'beat_variant' and scope_id = $2 limit 1",
        [userId, variantId],
      );
      return rows.length > 0;
    },
  };
}
