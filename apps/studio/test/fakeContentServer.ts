// A faithful in-memory fake of the content service, exposed as a fetch implementation. The studio cannot
// import the content service (read-only, and the package ships no client), so this fake mirrors the
// service's documented behavior for integration tests: server-authoritative defaults, enum and range
// guards, composite-FK and cross-series checks, and the resolved graph shape. It is a TEST DOUBLE, not a
// reimplementation that ships. If the studio's body assumptions drift from the real service, these tests
// are the early-warning. No em dashes.
import type {
  SeriesRow,
  EpisodeRow,
  BeatRow,
  VariantRow,
  EdgeRow,
  SeriesGraph,
  BeatRole,
  VariantTier,
  QaStatus,
} from "../src/api/contractGap.js";
import { BEAT_ROLES, VARIANT_TIERS, QA_STATUSES } from "../src/api/contractGap.js";

let counter = 0;
function uuid(): string {
  counter += 1;
  const hex = counter.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface FakeServer {
  fetch: typeof fetch;
  // Inspect what the last POST received, for assertions (for example the F1 user_id check).
  lastBodies: Array<{ path: string; body: unknown }>;
  // Insert the walking-skeleton "The Last Signal" fixture (mirrors supabase/seed.sql) so the studio can
  // load the real seed id in tests. Returns the seeded ids the UI references.
  seedLastSignal: () => { seriesId: string; episodeId: string; beatIds: string[] };
}

export function createFakeContentServer(): FakeServer {
  const series = new Map<string, SeriesRow>();
  const episodes = new Map<string, EpisodeRow>();
  const beats = new Map<string, BeatRow>();
  const variants = new Map<string, VariantRow>();
  const edges: EdgeRow[] = [];
  const lastBodies: Array<{ path: string; body: unknown }> = [];

  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
  const bad = (e: string) => json(400, { error: e });

  function buildGraph(seriesId: string): SeriesGraph | null {
    const s = series.get(seriesId);
    if (!s) return null;
    const eps = [...episodes.values()]
      .filter((e) => e.series_id === seriesId)
      .sort((a, b) => a.episode_number - b.episode_number)
      .map((e) => ({
        id: e.id,
        episode_number: e.episode_number,
        title: e.title,
        is_free: e.is_free,
        coin_cost: e.coin_cost,
        beats: [...beats.values()]
          .filter((b) => b.episode_id === e.id)
          .sort((a, b) => a.beat_index - b.beat_index)
          .map((b) => ({
            id: b.id,
            episode_id: b.episode_id,
            beat_index: b.beat_index,
            role: b.role,
            is_branch_point: b.is_branch_point,
            canon_facts: b.canon_facts,
            variants: [...variants.values()]
              .filter((v) => v.beat_id === b.id)
              .map((v) => ({
                id: v.id,
                language: v.language,
                accessibility: v.accessibility,
                intensity: v.intensity,
                pov: v.pov,
                tier: v.tier,
                is_premium: v.is_premium,
                coin_cost: v.coin_cost,
                playback_url: v.playback_url,
                duration_ms: v.duration_ms,
                qa_status: v.qa_status,
              })),
          })),
      }));
    const seriesBeatIds = new Set([...beats.values()].filter((b) => b.series_id === seriesId).map((b) => b.id));
    const graphEdges = edges
      .filter((e) => seriesBeatIds.has(e.from_beat_id))
      .map((e) => ({ from_beat_id: e.from_beat_id, to_beat_id: e.to_beat_id, condition: e.condition }));
    return { series: s, episodes: eps, edges: graphEdges };
  }

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const path = url.pathname;
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "GET") {
      if (path === "/feed") {
        const list = [...series.values()]
          .filter((s) => s.published_at)
          .map((s) => ({
            id: s.id,
            title: s.title,
            genre: s.genre,
            cover_url: s.cover_url,
            poster_url: s.poster_url ?? null,
            base_language: s.base_language,
            available_languages: s.available_languages,
            published_at: s.published_at,
          }));
        return json(200, { series: list });
      }
      if (path === "/series") {
        // ALL series incl drafts. Insertion order reversed approximates "newest first".
        const list = [...series.values()].reverse().map((s) => ({
          id: s.id,
          title: s.title,
          genre: s.genre,
          base_language: s.base_language,
          available_languages: s.available_languages,
          cover_url: s.cover_url,
          published_at: s.published_at ?? null,
          poster_url: s.poster_url ?? null,
        }));
        return json(200, { series: list });
      }
      const m = path.match(/^\/series\/([^/]+)\/graph$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (!UUID_RE.test(id)) return json(404, { error: "series_not_found" });
        const g = buildGraph(id);
        if (!g) return json(404, { error: "series_not_found" });
        return json(200, g);
      }
      return json(404, { error: "not_found" });
    }

    if (method === "PATCH") {
      let pbody: unknown;
      try {
        pbody = init?.body ? JSON.parse(init.body as string) : undefined;
      } catch {
        return json(400, { error: "invalid_json" });
      }
      const posterM = path.match(/^\/series\/([^/]+)\/poster$/);
      if (posterM) {
        const s = series.get(decodeURIComponent(posterM[1]));
        if (!s) return json(404, { error: "series_not_found" });
        if (!isObject(pbody) || typeof pbody.poster_url !== "string") return json(400, { error: "invalid_poster_url" });
        s.poster_url = pbody.poster_url;
        return json(200, { id: s.id, poster_url: s.poster_url });
      }
      const tracksM = path.match(/^\/variants\/([^/]+)\/tracks$/);
      if (tracksM) {
        const v = variants.get(decodeURIComponent(tracksM[1]));
        if (!v) return json(404, { error: "variant_not_found" });
        return json(200, v);
      }
      // PATCH /series/{id} : rename / update metadata. Only present fields change.
      const renameM = path.match(/^\/series\/([^/]+)$/);
      if (renameM) {
        const s = series.get(decodeURIComponent(renameM[1]));
        if (!s) return json(404, { error: "series_not_found" });
        if (!isObject(pbody)) return json(400, { error: "invalid_body" });
        if (pbody.title !== undefined) {
          if (typeof pbody.title !== "string" || pbody.title.trim().length === 0) return json(400, { error: "invalid_title" });
          s.title = pbody.title;
        }
        if (pbody.genre !== undefined) s.genre = (pbody.genre as string | null) ?? null;
        if (pbody.base_language !== undefined) s.base_language = pbody.base_language as string;
        if (pbody.available_languages !== undefined) s.available_languages = pbody.available_languages as string[];
        if (pbody.cover_url !== undefined) s.cover_url = (pbody.cover_url as string | null) ?? null;
        return json(200, { ...s });
      }
      return json(404, { error: "not_found" });
    }

    if (method === "DELETE") {
      const mv = path.match(/^\/variants\/([^/]+)$/);
      if (mv) {
        const id = decodeURIComponent(mv[1]);
        if (!UUID_RE.test(id)) return json(400, { error: "invalid_variant_id" });
        const existed = variants.delete(id);
        if (!existed) return json(404, { error: "variant_not_found" });
        return json(200, { id, deleted: true });
      }
      return json(404, { error: "not_found" });
    }

    if (method !== "POST") return json(404, { error: "not_found" });
    // Publish / unpublish carry no body (0009b).
    const pubM = path.match(/^\/series\/([^/]+)\/(publish|unpublish)$/);
    if (pubM) {
      const s = series.get(decodeURIComponent(pubM[1]));
      if (!s) return json(404, { error: "series_not_found" });
      s.published_at = pubM[2] === "publish" ? "2026-06-15T00:00:00.000Z" : null;
      return json(200, { id: s.id, published_at: s.published_at });
    }
    let body: unknown;
    try {
      body = init?.body ? JSON.parse(init.body as string) : undefined;
    } catch {
      return json(400, { error: "invalid_json" });
    }
    lastBodies.push({ path, body });
    if (!isObject(body)) return bad("invalid_body");

    // POST /beats/{id}/stream-upload : Cloudflare Stream is not configured on this fake (a local stack), so
    // it answers 501 and the studio falls back to the local media server.
    if (/^\/beats\/[^/]+\/stream-upload$/.test(path)) return json(501, { error: "stream_not_configured" });

    switch (path) {
      case "/series": {
        if (typeof body.title !== "string" || body.title.trim().length === 0) return bad("invalid_title");
        const row: SeriesRow = {
          id: uuid(),
          title: body.title,
          genre: (body.genre as string | null) ?? null,
          base_language: (body.base_language as string) ?? "en",
          available_languages: (body.available_languages as string[]) ?? [],
          cover_url: (body.cover_url as string | null) ?? null,
        };
        series.set(row.id, row);
        return json(201, row);
      }
      case "/episodes": {
        if (typeof body.series_id !== "string" || !UUID_RE.test(body.series_id)) return bad("invalid_series_id");
        if (!Number.isInteger(body.episode_number)) return bad("invalid_episode_number");
        if (body.coin_cost != null && (!Number.isInteger(body.coin_cost) || (body.coin_cost as number) < 0))
          return bad("invalid_coin_cost");
        if (!series.has(body.series_id)) return bad("unknown_series_id");
        const row: EpisodeRow = {
          id: uuid(),
          series_id: body.series_id,
          episode_number: body.episode_number as number,
          title: (body.title as string | null) ?? null,
          is_free: (body.is_free as boolean) ?? false,
          coin_cost: (body.coin_cost as number) ?? 0,
        };
        episodes.set(row.id, row);
        return json(201, row);
      }
      case "/beats": {
        if (typeof body.series_id !== "string" || !UUID_RE.test(body.series_id)) return bad("invalid_series_id");
        if (typeof body.episode_id !== "string" || !UUID_RE.test(body.episode_id)) return bad("invalid_episode_id");
        if (!Number.isInteger(body.beat_index)) return bad("invalid_beat_index");
        if (!BEAT_ROLES.includes(body.role as BeatRole)) return bad("invalid_role");
        const ep = episodes.get(body.episode_id);
        if (!ep) return bad("unknown_episode_id");
        if (ep.series_id !== body.series_id) return bad("series_episode_mismatch");
        const row: BeatRow = {
          id: uuid(),
          series_id: body.series_id,
          episode_id: body.episode_id,
          beat_index: body.beat_index as number,
          role: body.role as BeatRole,
          canon_facts: (body.canon_facts as Record<string, unknown>) ?? {},
          is_branch_point: (body.is_branch_point as boolean) ?? false,
        };
        beats.set(row.id, row);
        return json(201, row);
      }
      case "/variants": {
        if (typeof body.beat_id !== "string" || !UUID_RE.test(body.beat_id)) return bad("invalid_beat_id");
        if (!VARIANT_TIERS.includes(body.tier as VariantTier)) return bad("invalid_tier");
        if (typeof body.playback_url !== "string" || body.playback_url.length === 0) return bad("invalid_playback_url");
        if (
          body.intensity != null &&
          (!Number.isInteger(body.intensity) || (body.intensity as number) < 1 || (body.intensity as number) > 5)
        )
          return bad("invalid_intensity");
        if (body.coin_cost != null && (!Number.isInteger(body.coin_cost) || (body.coin_cost as number) < 0))
          return bad("invalid_coin_cost");
        if (body.qa_status != null && !QA_STATUSES.includes(body.qa_status as QaStatus)) return bad("invalid_qa_status");
        if (!beats.has(body.beat_id)) return bad("unknown_beat_id");
        const row: VariantRow = {
          id: uuid(),
          beat_id: body.beat_id,
          language: (body.language as string) ?? "en",
          accessibility: (body.accessibility as Record<string, unknown>) ?? {},
          intensity: (body.intensity as number) ?? 3,
          pov: (body.pov as string | null) ?? null,
          tier: body.tier as VariantTier,
          is_premium: (body.is_premium as boolean) ?? false,
          coin_cost: (body.coin_cost as number) ?? 0,
          playback_url: body.playback_url,
          duration_ms: (body.duration_ms as number | null) ?? null,
          provenance_id: (body.provenance_id as string | null) ?? null,
          qa_status: (body.qa_status as QaStatus) ?? "pending",
          placement_slots: (body.placement_slots as unknown[]) ?? [],
        };
        variants.set(row.id, row);
        return json(201, row);
      }
      case "/edges": {
        if (typeof body.from_beat_id !== "string" || !UUID_RE.test(body.from_beat_id)) return bad("invalid_from_beat_id");
        if (typeof body.to_beat_id !== "string" || !UUID_RE.test(body.to_beat_id)) return bad("invalid_to_beat_id");
        if (body.from_beat_id === body.to_beat_id) return bad("self_edge");
        const from = beats.get(body.from_beat_id);
        const to = beats.get(body.to_beat_id);
        if (!from) return bad("unknown_from_beat_id");
        if (!to) return bad("unknown_to_beat_id");
        if (from.series_id !== to.series_id) return bad("cross_series_edge");
        const row: EdgeRow = {
          from_beat_id: body.from_beat_id,
          to_beat_id: body.to_beat_id,
          condition: (body.condition as Record<string, unknown>) ?? {},
        };
        edges.push(row);
        return json(201, row);
      }
      default:
        return json(404, { error: "not_found" });
    }
  }) as typeof fetch;

  // Mirror supabase/seed.sql: The Last Signal, Ep 1, cold open -> branch -> {calm, tense} -> ending, plus a
  // premium alternate ending (5 coins). The graph response will NEST these and OMIT beat_id on variants,
  // which is exactly what the studio flatten must re-stamp.
  function seedLastSignal(): { seriesId: string; episodeId: string; beatIds: string[] } {
    const seriesId = "11111111-1111-1111-1111-111111111111";
    const episodeId = "22222222-2222-2222-2222-222222222222";
    const bCold = "bbbbbbbb-0000-0000-0000-000000000001";
    const bBranch = "bbbbbbbb-0000-0000-0000-000000000002";
    const bCalm = "bbbbbbbb-0000-0000-0000-00000000000a";
    const bTense = "bbbbbbbb-0000-0000-0000-00000000000b";
    const bEnd = "bbbbbbbb-0000-0000-0000-000000000004";

    series.set(seriesId, {
      id: seriesId,
      title: "The Last Signal",
      genre: "thriller",
      base_language: "en",
      available_languages: ["en"],
      cover_url: null,
      published_at: "2026-06-15T00:00:00.000Z",
    });
    episodes.set(episodeId, {
      id: episodeId,
      series_id: seriesId,
      episode_number: 1,
      title: "Pilot",
      is_free: true,
      coin_cost: 0,
    });
    const mkBeat = (id: string, idx: number, role: BeatRole, branch: boolean): void => {
      beats.set(id, {
        id,
        series_id: seriesId,
        episode_id: episodeId,
        beat_index: idx,
        role,
        canon_facts: {},
        is_branch_point: branch,
      });
    };
    mkBeat(bCold, 0, "cold_open", false);
    mkBeat(bBranch, 1, "spine", true);
    mkBeat(bCalm, 2, "variant", false);
    mkBeat(bTense, 2, "variant", false);
    mkBeat(bEnd, 3, "ending", false);

    const mkVar = (
      id: string,
      beatId: string,
      intensity: number,
      premium: boolean,
      coin: number,
    ): void => {
      variants.set(id, {
        id,
        beat_id: beatId,
        language: "en",
        accessibility: { captions: true },
        intensity,
        pov: null,
        tier: "A_filmed",
        is_premium: premium,
        coin_cost: coin,
        playback_url: `https://cdn.example/skel/${id}.m3u8`,
        duration_ms: 8000,
        provenance_id: null,
        qa_status: "passed",
        placement_slots: [],
      });
    };
    mkVar("cccccccc-0000-0000-0000-000000000001", bCold, 3, false, 0);
    mkVar("cccccccc-0000-0000-0000-000000000002", bBranch, 3, false, 0);
    mkVar("cccccccc-0000-0000-0000-00000000000a", bCalm, 2, false, 0);
    mkVar("cccccccc-0000-0000-0000-00000000000b", bTense, 5, false, 0);
    mkVar("cccccccc-0000-0000-0000-000000000004", bEnd, 3, false, 0);
    mkVar("cccccccc-0000-0000-0000-000000000005", bEnd, 4, true, 5);

    const mkEdge = (from: string, to: string, condition: Record<string, unknown>): void => {
      edges.push({ from_beat_id: from, to_beat_id: to, condition });
    };
    mkEdge(bCold, bBranch, {});
    mkEdge(bBranch, bCalm, { branch: "calm" });
    mkEdge(bBranch, bTense, { branch: "tense" });
    mkEdge(bCalm, bEnd, {});
    mkEdge(bTense, bEnd, {});

    return { seriesId, episodeId, beatIds: [bCold, bBranch, bCalm, bTense, bEnd] };
  }

  return { fetch: fetchImpl, lastBodies, seedLastSignal };
}
