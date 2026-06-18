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

// ---- Story-graph builders (GET /admin/story-graph/:seriesId) ----------------------------------------
//
// The graph is composed from series -> episodes -> beats -> beat_variants + beat_edges. The variant
// substrate columns (variant_kind, is_branch_point, is_ending, pov, intensity, coin_cost) come from the
// additive substrate (scripts/sql/variant_substrate_additive.sql). To stay safe on hosted projects where
// that script may not yet be applied, the substrate-derived flags are read defensively with COALESCE so a
// missing-but-declared column still returns rows. These remain SELECT-only; no writes anywhere.

// Beats for the graph: id, episode, ordering, narrative role, and the beat-level branch flag.
export function graphBeatsSql(seriesId: string): Sql {
  return {
    text:
      "select id, episode_id, beat_index, role, " +
      "coalesce(is_branch_point, false) as is_branch_point " +
      "from beats where series_id = $1 order by episode_id, beat_index",
    values: [seriesId],
  };
}

// Per-beat variant rollup for the graph node labels: whether any variant is premium-gated (locked), the
// minimum premium coin_cost (the cheapest unlock price), the strongest branch/ending signal across the
// beat's variants, and the dominant variant axis (pov/intensity) if the substrate marks one. Read through
// beats so it is scoped to one series. The substrate columns are referenced via the storygraph aggregate,
// which selects them with a tolerant projection; this builder selects the always-present beat join key
// plus the substrate fields the additive script declares.
export function graphVariantFlagsBySeriesSql(seriesId: string): Sql {
  return {
    text:
      "select v.beat_id, " +
      "bool_or(coalesce(v.is_premium, false)) as any_premium, " +
      "bool_or(coalesce(v.is_branch_point, false)) as any_branch, " +
      "bool_or(coalesce(v.is_ending, false)) as any_ending, " +
      "min(case when coalesce(v.is_premium, false) then coalesce(v.coin_cost, 0) end) as min_premium_cost, " +
      "max(v.variant_kind) as variant_kind " +
      "from beat_variants v join beats b on b.id = v.beat_id " +
      "where b.series_id = $1 group by v.beat_id",
    values: [seriesId],
  };
}

// Story-graph edges: the frozen beat_edges table, scoped to beats in this series. condition is the JSONB
// branch condition (display-only). A default-fallback flag is derived in the aggregate from the condition
// shape (an empty condition object is the canon default).
export function graphEdgesBySeriesSql(seriesId: string): Sql {
  return {
    text:
      "select e.from_beat_id, e.to_beat_id, e.condition " +
      "from beat_edges e " +
      "join beats bf on bf.id = e.from_beat_id " +
      "where bf.series_id = $1",
    values: [seriesId],
  };
}

// ---- Users (GET /admin/users, GET /admin/users/:id) -------------------------------------------------
//
// PRIVACY-MINIMIZED viewer admin. The list and detail read mobile.users for the minimal identity an
// operator needs to do support work: id, username, tier, created_at. Raw PII beyond that (email, auth_id,
// avatar) is NOT selected here. The wallet balance and the minimized history counts are joined/aggregated
// from coin_wallet, engagement_events, and coin_transactions. These reads NEVER touch decision_log,
// beat_variants, or any content-ranking surface: the user-admin plane is separate from content ranking.

// Page of users for the list, newest first. Minimal columns only (no email/auth_id). limit/offset are the
// page window so the list never unbounded-scans the table.
export function usersListSql(limit = 50, offset = 0): Sql {
  return {
    text:
      "select id, username, tier, created_at " +
      "from users order by created_at desc limit $1 offset $2",
    values: [limit, offset],
  };
}

// Total user count, for the list's pagination header. Separate from usersCountSql only in intent (this is
// the users-surface count); reuses the same minimal scan.
export function usersTotalSql(): Sql {
  return { text: "select count(*)::int as n from users", values: [] };
}

// One user's minimal identity by id. Same minimized projection as the list; the detail adds the joined
// wallet + history below, not more raw PII.
export function userByIdSql(id: string): Sql {
  return {
    text: "select id, username, tier, created_at from users where id = $1",
    values: [id],
  };
}

// A user's coin wallet balance (and bonus). LEFT-join semantics are applied in the aggregate by treating a
// missing row as zero; this builder simply reads the wallet row when present.
export function userWalletSql(userId: string): Sql {
  return {
    text: "select balance, bonus_balance from coin_wallet where user_id = $1",
    values: [userId],
  };
}

// Minimized per-user history COUNTS (not the rows): how many engagement events and coin transactions the
// user has. Counts, not raw event/transaction bodies, are the privacy-minimized history an operator needs.
// One round trip each, scoped to the user. coin_transactions also returns the net credited/spent so the
// support view can answer "how much have they bought/spent" without exposing individual receipts.
export function userEngagementCountSql(userId: string): Sql {
  return {
    text: "select count(*)::int as events from engagement_events where user_id = $1",
    values: [userId],
  };
}

export function userCoinHistorySql(userId: string): Sql {
  return {
    text:
      "select count(*)::int as transactions, " +
      "coalesce(sum(amount) filter (where amount > 0), 0)::int as credited, " +
      "coalesce(-sum(amount) filter (where amount < 0), 0)::int as spent " +
      "from coin_transactions where user_id = $1",
    values: [userId],
  };
}

// List-level history counts for ALL users in the page, in one pass each, keyed by user_id, so the list does
// not N+1 per user. The aggregate joins these onto the page rows by id. Scoped to nothing (full group-by)
// because the page is small and the group-by is indexed by user_id; the aggregate picks the page's ids.
export function usersEngagementCountsSql(): Sql {
  return {
    text: "select user_id, count(*)::int as events from engagement_events group by user_id",
    values: [],
  };
}

export function usersWalletBalancesSql(): Sql {
  return {
    text: "select user_id, balance, bonus_balance from coin_wallet",
    values: [],
  };
}

// ---- Creators (GET /admin/creators, GET /admin/creators/:id) ----------------------------------------
//
// There is NO creators table and NO series-ownership column in the hosted schema or the additive scripts.
// The creator view is therefore derived from series ownership IF present, else unwired. This builder is a
// tolerant existence probe: it asks the catalog whether a `series.owner_id`-style column exists before any
// derive is attempted. The aggregate uses the probe to decide between a derived view and an empty +
// unwired source, so we never fabricate creators. The probe reads only the information_schema catalog (no
// content rows), keeping the firewall intact.
export function seriesOwnerColumnProbeSql(): Sql {
  return {
    text:
      "select column_name from information_schema.columns " +
      "where table_schema in ('mobile', 'public') and table_name = 'series' " +
      "and column_name in ('owner_id', 'creator_id') limit 1",
    values: [],
  };
}

// ---- Analytics (GET /admin/analytics?dim=) ----------------------------------------------------------
//
// Aggregate the canonical event taxonomy (packages/analytics-sdk/src/events.ts), stored as the `type`
// column on mobile.engagement_events, into the requested dimension. These are SELECT-only group-by counts;
// the band derivation (lift as {low,high,center}) happens in the pure aggregate layer, never in SQL. The
// firewall holds: these reads touch engagement_events / decision_log / coin_transactions only, never a
// content-ranking weight.

// Funnel: count events per canonical funnel stage in ONE pass over engagement_events. The stages are the
// documented default funnel impression -> play -> view_3s -> completion_50 -> episode_completed -> unlock
// (unlock_purchased is the monetized terminal). Counted as filtered aggregates so a single scan yields the
// whole funnel. Distinct sessions per stage would be a later refinement; this counts events per stage,
// which is the honest raw funnel and is flagged as such in the aggregate.
export function funnelCountsSql(): Sql {
  return {
    text:
      "select " +
      "count(*) filter (where type = 'impression')::int as impression, " +
      "count(*) filter (where type = 'play')::int as play, " +
      "count(*) filter (where type = 'view_3s')::int as view_3s, " +
      "count(*) filter (where type = 'completion_50')::int as completion_50, " +
      "count(*) filter (where type = 'episode_completed')::int as episode_completed, " +
      "count(*) filter (where type = 'unlock_purchased')::int as unlock " +
      "from engagement_events",
    values: [],
  };
}

// Per-series funnel rollup (dim=series): the same funnel stages grouped by series_id, joined to the title.
// Drives the by-series analytics table. Limited so the table never unbounded-scans.
export function funnelBySeriesSql(limit = 50): Sql {
  return {
    text:
      "select e.series_id, s.title, " +
      "count(*) filter (where e.type = 'impression')::int as impression, " +
      "count(*) filter (where e.type = 'play')::int as play, " +
      "count(*) filter (where e.type = 'view_3s')::int as view_3s, " +
      "count(*) filter (where e.type = 'completion_50')::int as completion_50, " +
      "count(*) filter (where e.type = 'episode_completed')::int as episode_completed, " +
      "count(*) filter (where e.type = 'unlock_purchased')::int as unlock " +
      "from engagement_events e join series s on s.id = e.series_id " +
      "where e.series_id is not null " +
      "group by e.series_id, s.title order by play desc limit $1",
    values: [limit],
  };
}

// Per-episode funnel rollup (dim=episode): funnel stages grouped by episode_id. Limited.
export function funnelByEpisodeSql(limit = 100): Sql {
  return {
    text:
      "select e.episode_id, " +
      "count(*) filter (where e.type = 'play')::int as play, " +
      "count(*) filter (where e.type = 'completion_50')::int as completion_50, " +
      "count(*) filter (where e.type = 'episode_completed')::int as episode_completed " +
      "from engagement_events e where e.episode_id is not null " +
      "group by e.episode_id order by play desc limit $1",
    values: [limit],
  };
}

// Accessibility / language usage (dim=a11y, dim=language): counts of the toggle events that prove an a11y
// track or a language was actually used. caption/ad/sign toggles for a11y; language_switched for language.
export function a11yUsageSql(): Sql {
  return {
    text:
      "select " +
      "count(*) filter (where type = 'caption_toggled')::int as caption, " +
      "count(*) filter (where type = 'ad_toggled')::int as audio_description, " +
      "count(*) filter (where type = 'sign_toggled')::int as sign, " +
      "count(*) filter (where type = 'language_switched')::int as language " +
      "from engagement_events",
    values: [],
  };
}

// Branch lift (dim=branch): for each branch beat, count how a variant performed vs the control arm. The
// COUNTERFACTUAL is derived as a BAND in the aggregate, never a point. This reads the logged decisions
// (decision_log) joined to the downstream completion signal. The hosted decision_log carries variant_id,
// is_control, and reward; we count, per beat, treatment vs control completions and trials so the aggregate
// can form a lift band. is_control splits the two arms; created_at is not needed for the count.
export function branchOutcomesSql(limit = 50): Sql {
  return {
    text:
      "select beat_id, " +
      "count(*) filter (where not is_control)::int as treatment_trials, " +
      "count(*) filter (where not is_control and reward > 0)::int as treatment_success, " +
      "count(*) filter (where is_control)::int as control_trials, " +
      "count(*) filter (where is_control and reward > 0)::int as control_success " +
      "from decision_log where beat_id is not null " +
      "group by beat_id order by treatment_trials desc limit $1",
    values: [limit],
  };
}

// Retention (dim=retention): distinct users seen on day 0 vs returning on later days. The hosted schema has
// no precomputed cohort table; this is a coarse day-bucketed distinct-user count over engagement_events
// that the aggregate folds into a retention curve. Counts distinct users per day offset from their first
// seen event. This is a heavier query; it is bounded to the trailing window in the aggregate via the param.
export function retentionByDaySql(windowDays = 30): Sql {
  return {
    text:
      "with first_seen as (" +
      "select user_id, min(ts)::date as d0 from engagement_events " +
      "where user_id is not null and ts >= now() - ($1 || ' days')::interval group by user_id" +
      ") " +
      "select (e.ts::date - f.d0) as day_offset, count(distinct e.user_id)::int as users " +
      "from engagement_events e join first_seen f on f.user_id = e.user_id " +
      "where e.ts >= now() - ($1 || ' days')::interval " +
      "group by day_offset order by day_offset",
    values: [String(windowDays)],
  };
}

// ---- Monetization (GET /admin/monetization) ---------------------------------------------------------
//
// Pricing config lives in the LIVE economy services (not imported or edited here). This service READS what
// the hosted schema observably carries: the distinct coin_transactions types in use, and the observed
// per-type coin volume, so the monetization view shows what is actually transacting. The documented default
// pricing rule set (packs/subs/premium) is a READ MODEL returned by the aggregate as a constant with a
// source flag, NOT read from a table that does not exist. Reward weights are returned display-only by the
// aggregate as a constant DRAFT marker and are NEVER selected here.

// Observed transaction types + volume from the ledger, so the pricing view can flag which configured rules
// are actually firing. SELECT-only over coin_transactions.
export function monetizationLedgerSql(): Sql {
  return {
    text:
      "select type, count(*)::int as count, " +
      "coalesce(sum(amount) filter (where amount > 0), 0)::int as credited, " +
      "coalesce(-sum(amount) filter (where amount < 0), 0)::int as spent " +
      "from coin_transactions group by type order by count desc",
    values: [],
  };
}

// Observed episode + variant coin prices actually configured in the catalog, so the premium-cut pricing
// view reflects real content prices (server-priced; the client never sets these). Reads episodes.coin_cost
// and beat_variants.coin_cost as a distribution, not per-row PII.
export function episodePriceDistributionSql(): Sql {
  return {
    text:
      "select coin_cost, count(*)::int as episodes " +
      "from episodes where coin_cost is not null and coin_cost > 0 " +
      "group by coin_cost order by coin_cost",
    values: [],
  };
}

export function variantPriceDistributionSql(): Sql {
  return {
    text:
      "select coin_cost, count(*)::int as variants " +
      "from beat_variants where is_premium and coin_cost is not null and coin_cost > 0 " +
      "group by coin_cost order by coin_cost",
    values: [],
  };
}

// ---- Growth (GET /admin/growth) ---------------------------------------------------------------------
//
// Referral-loop health from mobile.referrals: counts by funnel status (invited/joined/first_watch) and how
// many had a reward granted. reward_granted is a NEUTRAL bookkeeping flag (per 05_referrals.sql), never an
// optimization target; we only count it. SELECT-only.
export function referralHealthSql(): Sql {
  return {
    text:
      "select " +
      "count(*) filter (where status = 'invited')::int as invited, " +
      "count(*) filter (where status = 'joined')::int as joined, " +
      "count(*) filter (where status = 'first_watch')::int as first_watch, " +
      "count(*) filter (where reward_granted)::int as reward_granted, " +
      "count(*)::int as total " +
      "from referrals",
    values: [],
  };
}

// Probe for a creative-experiment table (services/experiment data shape). The hosted schema has no creative
// bandit table; this catalog probe lets the aggregate return an empty typed shape + source:"unwired" rather
// than fabricating win-rates. Reads only information_schema (no content rows), keeping the firewall intact.
export function creativeExperimentTableProbeSql(): Sql {
  return {
    text:
      "select table_name from information_schema.tables " +
      "where table_schema in ('mobile', 'public') " +
      "and table_name in ('creative_tests', 'creative_experiments', 'experiment_arms') limit 1",
    values: [],
  };
}

// ---- Moderation (GET /admin/moderation/queue) -------------------------------------------------------
//
// UGC moderation (reports/comments/posts) is the SOCIAL V8 surface, which has no tables in the hosted
// schema yet. This is a tolerant catalog probe over information_schema: it asks whether ANY of the social
// UGC tables exist before any read is attempted. The aggregate uses the probe to decide between reading a
// real queue and returning an empty + source:"unwired" view, so moderation items are NEVER fabricated.
// Reads only the information_schema catalog (no UGC rows), keeping the firewall intact.
export function socialTablesProbeSql(): Sql {
  return {
    text:
      "select table_name from information_schema.tables " +
      "where table_schema in ('mobile', 'public') " +
      "and table_name in ('posts', 'comments', 'reports', 'moderation_reports', 'ugc_reports') ",
    values: [],
  };
}

// ---- Trust: provenance (GET /admin/trust/provenance) ------------------------------------------------
//
// C2PA / content-credentials signing status per asset, read from the additive substrate columns on
// beat_variants (variant_substrate_additive.sql: c2pa_signed, c2pa_manifest_url, provenance_id,
// content_credentials, article50_ai_label). To stay safe on hosted projects where that script may not be
// applied yet, the aggregate probes for the columns first and reads them defensively. This probe asks the
// catalog whether the c2pa/provenance columns exist before any select. Reads only information_schema.
export function provenanceColumnsProbeSql(): Sql {
  return {
    text:
      "select column_name from information_schema.columns " +
      "where table_schema in ('mobile', 'public') and table_name = 'beat_variants' " +
      "and column_name in ('c2pa_signed', 'c2pa_manifest_url', 'provenance_id', 'article50_ai_label')",
    values: [],
  };
}

// Per-asset C2PA signing status distribution + a bounded sample of recently-recorded assets. SELECT-only
// over beat_variants, reading ONLY the provenance/c2pa columns (no playback URLs, no PII). Aggregated as a
// signed/unsigned distribution plus a small recent sample so the console renders the surface without an
// unbounded scan. Only invoked by the aggregate AFTER the column probe confirms the columns exist.
export function provenanceStatusSql(limit = 50): Sql {
  return {
    text:
      "select id as variant_id, " +
      "coalesce(c2pa_signed, false) as c2pa_signed, " +
      "(c2pa_manifest_url is not null) as has_manifest, " +
      "(provenance_id is not null) as has_provenance, " +
      "article50_ai_label " +
      "from beat_variants order by id limit $1",
    values: [limit],
  };
}

// Signed-vs-unsigned rollup for the provenance summary card. One pass over beat_variants reading only the
// c2pa flag. Only invoked after the column probe confirms the column exists.
export function provenanceRollupSql(): Sql {
  return {
    text:
      "select count(*)::int as total, " +
      "count(*) filter (where coalesce(c2pa_signed, false))::int as signed, " +
      "count(*) filter (where c2pa_manifest_url is not null)::int as with_manifest, " +
      "count(*) filter (where provenance_id is not null)::int as with_provenance " +
      "from beat_variants",
    values: [],
  };
}

// ---- Finance (GET /admin/finance) -------------------------------------------------------------------
//
// The double-entry-style ledger view is composed from coin_transactions. These are SELECT-only group-by
// aggregates: totals (credited in vs spent), a per-type breakdown (the revenue-by-source rows), and the
// gross purchase volume that feeds the creator-payout accrual (split via revenue.ts, display-only). No
// payout is executed; payout-run is a 501 audit seam. Stripe stays TEST; no live rail is invoked here.

// Double-entry totals: credits in, debits out, net, and the transaction count. Positive amounts are
// credits (purchases/grants), negatives are spends. Mirrors coinTotalsSql but is scoped to the finance
// surface intent and adds the net so the console shows the ledger balances.
export function financeLedgerTotalsSql(): Sql {
  return {
    text:
      "select count(*)::int as transactions, " +
      "coalesce(sum(amount) filter (where amount > 0), 0)::int as credited, " +
      "coalesce(-sum(amount) filter (where amount < 0), 0)::int as spent, " +
      "coalesce(sum(amount), 0)::int as net " +
      "from coin_transactions",
    values: [],
  };
}

// Revenue by source/type: per transaction `type`, the count and the gross credited (positive amounts) and
// spent (negative). This is the revenue-by-source breakdown the finance view needs; "revenue" here is the
// observed ledger volume per source, never a fabricated currency figure. SELECT-only over coin_transactions.
export function financeRevenueByTypeSql(): Sql {
  return {
    text:
      "select type, count(*)::int as count, " +
      "coalesce(sum(amount) filter (where amount > 0), 0)::int as credited, " +
      "coalesce(-sum(amount) filter (where amount < 0), 0)::int as spent " +
      "from coin_transactions group by type order by credited desc",
    values: [],
  };
}

// The gross creator-revenue base for the payout accrual: the sum of purchase-type credits. The creator
// 70/30 split is applied in the aggregate via the revenue.ts helper (display-only; no payout executed).
// `purchase` is the monetized inflow; grants/rewards are excluded from the creator-revenue base.
export function financePurchaseGrossSql(): Sql {
  return {
    text:
      "select coalesce(sum(amount) filter (where amount > 0 and type = 'purchase'), 0)::int as gross " +
      "from coin_transactions",
    values: [],
  };
}

// ---- Trust: consent ledger (GET /admin/trust/consent) -----------------------------------------------
//
// MINIMIZED consent-ledger read. Consent + biometric data lives on the SOVEREIGN plane and is NEVER
// returned in full to the console. There is no consent table in the hosted schema; a catalog probe decides
// between a minimized read and an empty + unwired view. This probe asks whether a consent ledger table
// exists. Reads only information_schema (no consent rows), keeping the sovereign-plane firewall intact.
export function consentTableProbeSql(): Sql {
  return {
    text:
      "select table_name from information_schema.tables " +
      "where table_schema in ('mobile', 'public') " +
      "and table_name in ('consent_ledger', 'consents', 'consent_records')",
    values: [],
  };
}

// ---- Admin settings: audit log (GET /admin/settings/audit) ------------------------------------------
//
// A PAGED read of the immutable audit trail (mobile.admin_audit_log, the table queued in
// scripts/sql/07_admin_audit.sql). The table may be UNAPPLIED on the hosted project, so a tolerant catalog
// probe decides between a real read and an empty + source:"unwired" view (the audit page is never
// fabricated). Reads are ordered ts DESC (newest first) and bounded by limit/offset so the trail never
// unbounded-scans. The probe reads only information_schema (no audit rows), so it is safe pre-apply.
export function adminAuditTableProbeSql(): Sql {
  return {
    text:
      "select table_name from information_schema.tables " +
      "where table_schema = 'mobile' and table_name = 'admin_audit_log' limit 1",
    values: [],
  };
}

// One page of audit rows, newest first. SELECT-only over the append-only table. limit/offset are the page
// window so the read is bounded. Only invoked by the aggregate AFTER the table probe confirms the table
// exists (so a pre-apply project never errors on a missing relation).
export function adminAuditPageSql(limit = 50, offset = 0): Sql {
  return {
    text:
      "select id, ts, operator_id, role, action, target, before, after " +
      "from mobile.admin_audit_log order by ts desc limit $1 offset $2",
    values: [limit, offset],
  };
}

// Total audit-row count for the page's pagination header. Only invoked after the table probe confirms the
// table exists.
export function adminAuditCountSql(): Sql {
  return { text: "select count(*)::int as n from mobile.admin_audit_log", values: [] };
}

// ---- Accessibility readiness (GET /admin/accessibility) ---------------------------------------------

// Per-series accessibility track coverage: total variants and how many carry each of the four tracks
// (captions, audio description, sign, dub). Joined up through beats to series so each row is one series.
// Drives the 0..100 readiness score and the blocker list in the aggregate.
export function accessibilityCoverageSql(): Sql {
  return {
    text:
      "select b.series_id, " +
      "count(v.*)::int as total, " +
      "count(v.*) filter (where v.caption_doc_url is not null)::int as with_captions, " +
      "count(v.*) filter (where v.audio_description_url is not null)::int as with_ad, " +
      "count(v.*) filter (where v.sign_video_url is not null)::int as with_sign, " +
      "count(v.*) filter (where v.dub_audio_urls is not null and v.dub_audio_urls::text <> '{}')::int as with_dub " +
      "from beats b join beat_variants v on v.beat_id = b.id " +
      "group by b.series_id",
    values: [],
  };
}
