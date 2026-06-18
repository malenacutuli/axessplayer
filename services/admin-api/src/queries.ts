// Pure aggregate query builders for the admin API. Each function returns a { text, values } shape (the
// node-postgres query object) and touches NO database. This separation is what makes the KPI SQL
// unit-testable with a fake pg: a test asserts the SQL text and parameter shape without a live Postgres.
//
// All table names are UNQUALIFIED. On the shared hosted project the connection sets
// search_path=mobile,public (DB_OPTIONS), so unqualified names resolve to the isolated `mobile` schema,
// exactly as the content and decision services do. The admin API is READ-ONLY: every builder here is a
// SELECT. There are no INSERT/UPDATE/DELETE builders, by design.
//
// HARD GATE: reward-function weights are never read or written here as a tunable. The dashboard surfaces
// the LATEST policy_version string from decision_log (display-only provenance), never an editable weight.
// No em dashes.

export interface Sql {
  text: string;
  values: unknown[];
}

// ---- Dashboard KPI builders -------------------------------------------------------------------------

// Total registered users.
export function usersCountSql(): Sql {
  return { text: "select count(*)::int as n from users", values: [] };
}

// Engagement: watch starts vs completions from the append-only event stream. `type` is the event name
// emitted by the analytics-sdk; starts and completions are counted in one pass.
export function engagementSql(): Sql {
  return {
    text:
      "select " +
      "count(*) filter (where type = 'watch_start')::int as starts, " +
      "count(*) filter (where type = 'watch_complete')::int as completions, " +
      "count(*)::int as total " +
      "from engagement_events",
    values: [],
  };
}

// Decisions served (adaptive engine volume), and how many were control (director's cut). The split is the
// treatment-vs-control denominator the engine-health card needs.
export function decisionsSql(): Sql {
  return {
    text:
      "select count(*)::int as total, " +
      "count(*) filter (where is_control)::int as control " +
      "from decision_log",
    values: [],
  };
}

// The latest policy_version observed in the decision log. DISPLAY-ONLY provenance: it tells an operator
// which policy build is serving, never lets them edit a reward weight. Reward weights are a founder
// sign-off, not an operator action, so they are not selectable or mutable anywhere in this service.
export function latestPolicyVersionSql(): Sql {
  return {
    text:
      "select policy_version from decision_log " +
      "where policy_version is not null order by created_at desc limit 1",
    values: [],
  };
}

// Coin ledger: credits purchased vs spent, and a breakdown by transaction type. Positive amounts are
// credits in (purchases, grants, rewarded ads); negative amounts are spends.
export function coinTotalsSql(): Sql {
  return {
    text:
      "select count(*)::int as transactions, " +
      "coalesce(sum(amount) filter (where amount > 0), 0)::int as credited, " +
      "coalesce(-sum(amount) filter (where amount < 0), 0)::int as spent, " +
      "coalesce(sum(amount) filter (where type = 'purchase'), 0)::int as purchased " +
      "from coin_transactions",
    values: [],
  };
}

export function coinByTypeSql(): Sql {
  return {
    text:
      "select type, count(*)::int as count, coalesce(sum(amount), 0)::int as coins " +
      "from coin_transactions group by type order by count desc",
    values: [],
  };
}

// Series inventory: published vs total.
export function seriesInventorySql(): Sql {
  return {
    text:
      "select count(*)::int as total, " +
      "count(*) filter (where published_at is not null)::int as published " +
      "from series",
    values: [],
  };
}

// Variant inventory + accessibility coverage. Mirrors the content service's overview shape: per-track
// coverage counts feed the a11y completeness meters.
export function variantInventorySql(): Sql {
  return {
    text:
      "select count(*)::int as total, " +
      "count(*) filter (where is_premium)::int as premium, " +
      "count(*) filter (where qa_status = 'passed')::int as qa_passed, " +
      "count(*) filter (where caption_doc_url is not null)::int as with_captions, " +
      "count(*) filter (where audio_description_url is not null)::int as with_ad, " +
      "count(*) filter (where sign_video_url is not null)::int as with_sign, " +
      "count(*) filter (where dub_audio_urls is not null and dub_audio_urls::text <> '{}')::int as with_dub " +
      "from beat_variants",
    values: [],
  };
}

// Top series by engagement volume (event count joined to the series title). Drives the "top series" card.
// LEFT-less inner join on series so only known series appear; limit is the card size.
export function topSeriesByEngagementSql(limit = 5): Sql {
  return {
    text:
      "select s.id, s.title, count(e.*)::int as events " +
      "from engagement_events e join series s on s.id = e.series_id " +
      "group by s.id, s.title order by events desc limit $1",
    values: [limit],
  };
}

// ---- Content tree builders --------------------------------------------------------------------------

// The channel layer (additive overlay: mobile.channels). The content tree is rooted at channels; each
// channel fans out to series via the series_channels join. Channels carry no per-series status of their
// own, so the tree derives channel status from its series.
export function channelsSql(): Sql {
  return {
    text: "select id, slug, name from channels order by name",
    values: [],
  };
}

export function seriesChannelMapSql(): Sql {
  return {
    text: "select series_id, channel_id from series_channels",
    values: [],
  };
}

// Series list with publish status, for the content tree. published_at NULL means draft/unpublished.
export function seriesListSql(): Sql {
  return {
    text:
      "select id, title, genre, published_at, created_at from series order by created_at desc",
    values: [],
  };
}

// Episodes for the content tree, grouped client-side by series_id.
export function episodesListSql(): Sql {
  return {
    text:
      "select id, series_id, episode_number, title, is_free, published_at " +
      "from episodes order by series_id, episode_number",
    values: [],
  };
}

// Per-series variant + a11y rollup for the tree status chips. Joins variants up through beats to series
// so each series row carries its variant count and accessibility coverage without N+1 queries.
export function variantRollupBySeriesSql(): Sql {
  return {
    text:
      "select b.series_id, count(v.*)::int as variants, " +
      "count(v.*) filter (where v.qa_status = 'passed')::int as qa_passed, " +
      "count(v.*) filter (where v.caption_doc_url is not null)::int as with_captions, " +
      "count(v.*) filter (where v.audio_description_url is not null)::int as with_ad, " +
      "count(v.*) filter (where v.sign_video_url is not null)::int as with_sign " +
      "from beats b join beat_variants v on v.beat_id = b.id " +
      "group by b.series_id",
    values: [],
  };
}

// ---- Content detail builders (GET /admin/content/:id, a single series) -----------------------------

export function seriesByIdSql(id: string): Sql {
  return {
    text:
      "select id, title, genre, base_language, available_languages, published_at, poster_url, created_at " +
      "from series where id = $1",
    values: [id],
  };
}

export function episodesBySeriesSql(seriesId: string): Sql {
  return {
    text:
      "select id, episode_number, title, is_free, coin_cost, published_at " +
      "from episodes where series_id = $1 order by episode_number",
    values: [seriesId],
  };
}

export function beatsBySeriesSql(seriesId: string): Sql {
  return {
    text:
      "select id, episode_id, beat_index, role, is_branch_point " +
      "from beats where series_id = $1 order by episode_id, beat_index",
    values: [seriesId],
  };
}

export function variantsBySeriesSql(seriesId: string): Sql {
  return {
    text:
      "select v.id, v.beat_id, v.language, v.tier, v.intensity, v.is_premium, v.qa_status, " +
      "v.caption_doc_url, v.audio_description_url, v.sign_video_url " +
      "from beat_variants v join beats b on b.id = v.beat_id " +
      "where b.series_id = $1 order by v.beat_id, v.id",
    values: [seriesId],
  };
}
