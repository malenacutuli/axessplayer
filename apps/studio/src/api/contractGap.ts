// CONTRACT GAP (queued, orchestrator-owned). See AGENTS/W7_studio.md and content.yaml 0.3.1.
//
// content.yaml documents the create endpoints (POST /series, /episodes, /beats, /variants, /edges) and
// the graph read (GET /series/{id}/graph) but defines NO request-body schemas and NO 200 graph response
// schema. In the generated types every create operation has `requestBody?: never` and the graph 200 has
// `content?: never`. The content SERVICE validates every field server-side (enums, intensity 1..5,
// non-negative coin_cost, composite-FK) and is the de-facto source of truth for the payload shapes.
//
// Because the contracts package exposes no `exports` map (and the content service ships no published
// client), the studio cannot import the service's body types at runtime. So this module RE-DECLARES the
// request bodies to mirror services/content/src/content.ts exactly, and re-declares the graph read model.
// THIS IS THE WORKAROUND, NOT A CONTRACT. When the queued content.yaml enrichment lands, replace every
// type below with the codegen request/response schemas and delete this file. Search for "CONTRACT GAP".
//
// What IS bound to the codegen today: the graph operation's existence and its path-param type, asserted
// in `./client.ts`, so a drift on the documented path or {id} param still breaks the studio typecheck.
//
// No em dashes.

// ---------- enums (frozen schema column comments, mirrored from the content service) ----------
export const BEAT_ROLES = ["spine", "hero", "variant", "connective", "ending", "cold_open"] as const;
export type BeatRole = (typeof BEAT_ROLES)[number];

export const VARIANT_TIERS = ["A_filmed", "B_likeness", "C_ai"] as const;
export type VariantTier = (typeof VARIANT_TIERS)[number];

export const QA_STATUSES = ["pending", "passed", "rejected"] as const;
export type QaStatus = (typeof QA_STATUSES)[number];

// ---------- request bodies (mirror of content service exported body types) ----------
// F1 GUARDRAIL: none of these bodies carries a `user_id`. The content authoring API takes no actor id in
// the body. The studio NEVER adds one. The fetch client also strips any `user_id` key defensively.
export interface CreateSeriesBody {
  title: string;
  genre?: string | null;
  base_language?: string;
  available_languages?: string[];
  cover_url?: string | null;
}

export interface CreateEpisodeBody {
  series_id: string;
  episode_number: number;
  title?: string | null;
  is_free?: boolean; // server default false
  coin_cost?: number; // server default 0
}

export interface CreateBeatBody {
  series_id: string;
  episode_id: string;
  beat_index: number;
  role: BeatRole;
  canon_facts?: Record<string, unknown>;
  is_branch_point?: boolean;
}

export interface CreateVariantBody {
  beat_id: string;
  language?: string; // server default en
  accessibility?: Record<string, unknown>;
  intensity?: number; // 1..5, server default 3
  pov?: string | null;
  tier: VariantTier;
  is_premium?: boolean; // server default false
  coin_cost?: number; // server default 0
  playback_url: string;
  duration_ms?: number | null;
  provenance_id?: string | null;
  qa_status?: QaStatus;
  placement_slots?: unknown[];
}

export interface CreateEdgeBody {
  from_beat_id: string;
  to_beat_id: string;
  condition?: Record<string, unknown>;
}

// ---------- created rows (echoed in the 201, mirror of the service) ----------
export interface SeriesRow {
  id: string;
  title: string;
  genre: string | null;
  base_language: string;
  available_languages: string[];
  cover_url: string | null;
  published_at?: string | null;
  poster_url?: string | null;
}
export interface EpisodeRow {
  id: string;
  series_id: string;
  episode_number: number;
  title: string | null;
  is_free: boolean;
  coin_cost: number;
}
export interface BeatRow {
  id: string;
  series_id: string;
  episode_id: string;
  beat_index: number;
  role: BeatRole;
  canon_facts: Record<string, unknown>;
  is_branch_point: boolean;
}
export interface VariantRow {
  id: string;
  beat_id: string;
  language: string;
  accessibility: Record<string, unknown>;
  intensity: number;
  pov: string | null;
  tier: VariantTier;
  is_premium: boolean;
  coin_cost: number;
  playback_url: string;
  duration_ms: number | null;
  provenance_id: string | null;
  qa_status: QaStatus;
  placement_slots: unknown[];
}
export interface EdgeRow {
  from_beat_id: string;
  to_beat_id: string;
  condition: Record<string, unknown>;
}

// ---------- the resolved playable graph (GET /series/{id}/graph 200 body, mirror of the service) ----------
export interface GraphVariant {
  id: string;
  language: string;
  accessibility: Record<string, unknown>;
  intensity: number;
  pov: string | null;
  tier: VariantTier;
  is_premium: boolean;
  coin_cost: number;
  playback_url: string;
  duration_ms: number | null;
  qa_status: QaStatus;
}
export interface GraphBeat {
  id: string;
  episode_id: string;
  beat_index: number;
  role: BeatRole;
  is_branch_point: boolean;
  canon_facts: Record<string, unknown>;
  variants: GraphVariant[];
}
export interface GraphEpisode {
  id: string;
  episode_number: number;
  title: string | null;
  is_free: boolean;
  coin_cost: number;
  beats: GraphBeat[];
}
export interface GraphEdge {
  from_beat_id: string;
  to_beat_id: string;
  condition: Record<string, unknown>;
}
export interface SeriesGraph {
  series: SeriesRow;
  episodes: GraphEpisode[];
  edges: GraphEdge[];
}

export interface ApiError {
  error: string;
}
