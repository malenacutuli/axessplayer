-- Axessplayer mobile-app schema deploy for the SHARED hosted Supabase project.
--
-- Target: project faeyekynudyzeotbjfsj (the axessplayer.com web product DB).
-- Purpose: stand up the adaptive-cinema mobile app tables in an ISOLATED `mobile` schema so they reuse this
-- project's secrets, S3/R2, edge functions, and Stripe billing WITHOUT colliding with the web product in public.
--
-- This is a DEPLOYMENT TRANSFORM of the frozen repo migrations 0001-0008. The canonical migrations under
-- supabase/migrations are NOT edited and remain public-schema for local dev. Here, the only change is that the
-- ledger functions (0003, 0004) are retargeted from public.* to mobile.* while preserving the F2 security lock
-- (SET search_path = '' plus full schema-qualification). 0002 is intentionally omitted: 0003 fully supersedes it.
--
-- Verified on apply: ledger grant/spend/idempotency/own-once correct, overspend rejected, public untouched.
-- No em dashes.

CREATE SCHEMA IF NOT EXISTS mobile;
SET search_path TO mobile, public;

-- ===== 0001_init (tables + RLS floor), schema-qualified to mobile =====
CREATE TABLE IF NOT EXISTS mobile.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  preferred_language TEXT DEFAULT 'en',
  adaptive_opt_in BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS mobile.series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL, genre TEXT,
  base_language TEXT DEFAULT 'en',
  available_languages TEXT[] DEFAULT '{}',
  cover_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS mobile.episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES mobile.series(id),
  episode_number INTEGER NOT NULL,
  title TEXT,
  is_free BOOLEAN DEFAULT FALSE,
  coin_cost INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (id, series_id)
);
CREATE INDEX IF NOT EXISTS idx_episodes_series ON mobile.episodes(series_id, episode_number);
CREATE TABLE IF NOT EXISTS mobile.beats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL,
  episode_id UUID NOT NULL,
  beat_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  canon_facts JSONB DEFAULT '{}',
  is_branch_point BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (episode_id, series_id) REFERENCES mobile.episodes(id, series_id)
);
CREATE INDEX IF NOT EXISTS idx_beats_episode ON mobile.beats(episode_id, beat_index);
CREATE TABLE IF NOT EXISTS mobile.beat_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beat_id UUID NOT NULL REFERENCES mobile.beats(id),
  language TEXT NOT NULL DEFAULT 'en',
  accessibility JSONB DEFAULT '{}',
  intensity SMALLINT DEFAULT 3,
  pov TEXT,
  tier TEXT NOT NULL,
  is_premium BOOLEAN DEFAULT FALSE,
  coin_cost INTEGER NOT NULL DEFAULT 0,
  playback_url TEXT NOT NULL,
  duration_ms INTEGER,
  provenance_id UUID,
  qa_status TEXT DEFAULT 'pending',
  placement_slots JSONB DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_variants_beat ON mobile.beat_variants(beat_id);
CREATE TABLE IF NOT EXISTS mobile.beat_edges (
  from_beat_id UUID REFERENCES mobile.beats(id),
  to_beat_id UUID REFERENCES mobile.beats(id),
  condition JSONB DEFAULT '{}',
  PRIMARY KEY (from_beat_id, to_beat_id)
);
CREATE TABLE IF NOT EXISTS mobile.viewer_state (
  user_id UUID REFERENCES mobile.users(id),
  series_id UUID NOT NULL REFERENCES mobile.series(id),
  preference_vector JSONB DEFAULT '{}',
  cohort_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, series_id)
);
CREATE TABLE IF NOT EXISTS mobile.decision_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES mobile.users(id),
  beat_id UUID REFERENCES mobile.beats(id),
  served_variant_id UUID REFERENCES mobile.beat_variants(id),
  is_control BOOLEAN DEFAULT FALSE,
  policy_version TEXT,
  reward JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_decision_user ON mobile.decision_log(user_id, created_at);
CREATE TABLE IF NOT EXISTS mobile.coin_wallet (
  user_id UUID REFERENCES mobile.users(id) PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  bonus_balance INTEGER NOT NULL DEFAULT 0 CHECK (bonus_balance >= 0),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS mobile.coin_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES mobile.users(id),
  amount INTEGER NOT NULL,
  type TEXT NOT NULL,
  client_txn_id TEXT NOT NULL,
  reference_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, client_txn_id)
);
CREATE TABLE IF NOT EXISTS mobile.entitlements (
  user_id UUID REFERENCES mobile.users(id),
  scope TEXT NOT NULL,
  scope_id UUID NOT NULL,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, scope, scope_id)
);
CREATE TABLE IF NOT EXISTS mobile.content_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beat_variant_id UUID NOT NULL REFERENCES mobile.beat_variants(id),
  manifest JSONB NOT NULL,
  tier TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS mobile.consent_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  likeness_subject TEXT NOT NULL,
  beat_variant_id UUID NOT NULL REFERENCES mobile.beat_variants(id),
  consent_ref TEXT NOT NULL,
  royalty_terms JSONB,
  prev_hash TEXT, row_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE mobile.users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile.series              ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile.episodes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile.beats               ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile.beat_variants       ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile.beat_edges          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile.viewer_state        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile.decision_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile.coin_wallet         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile.coin_transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile.entitlements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile.content_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile.consent_ledger      ENABLE ROW LEVEL SECURITY;

-- ===== 0005 / 0006 / 0007 / 0008 additive columns =====
ALTER TABLE mobile.decision_log  ADD COLUMN IF NOT EXISTS propensity DOUBLE PRECISION;
ALTER TABLE mobile.series        ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE mobile.episodes      ADD COLUMN IF NOT EXISTS published_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_series_published ON mobile.series (published_at);
ALTER TABLE mobile.beat_variants ADD COLUMN IF NOT EXISTS caption_doc_url       text;
ALTER TABLE mobile.beat_variants ADD COLUMN IF NOT EXISTS audio_description_url text;
ALTER TABLE mobile.beat_variants ADD COLUMN IF NOT EXISTS sign_video_url        text;
ALTER TABLE mobile.beat_variants ADD COLUMN IF NOT EXISTS dub_audio_urls        jsonb default '{}'::jsonb;
ALTER TABLE mobile.series        ADD COLUMN IF NOT EXISTS poster_url        text;
ALTER TABLE mobile.series        ADD COLUMN IF NOT EXISTS poster_provenance jsonb;

-- ===== Engagement event log (P3-T1). Append-only stream from the analytics-sdk via the events collector
-- (services/events). No hard FKs: high-volume ingest must not drop an event on a missing join key; ids
-- are join keys read-side. Idempotent on (session_id, event_id). =====
CREATE TABLE IF NOT EXISTS mobile.engagement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  user_id UUID,
  series_id UUID,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  decision_id UUID,
  beat_id UUID,
  variant_id UUID,
  completion DOUBLE PRECISION,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_engagement_decision ON mobile.engagement_events(decision_id);
CREATE INDEX IF NOT EXISTS idx_engagement_session  ON mobile.engagement_events(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_engagement_type     ON mobile.engagement_events(type, ts);
ALTER TABLE mobile.engagement_events ENABLE ROW LEVEL SECURITY;

-- ===== 0003 + 0004 ledger functions: retargeted public.* -> mobile.*, F2 search_path='' preserved =====
-- (function bodies identical to the frozen migrations except every object is mobile-qualified)
-- See infra/hosted/mobile_schema_functions.sql for the spend_coins and grant_coins definitions applied.
