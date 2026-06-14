-- Axessplayer schema. Contract version 0.3.0. Owned by W0. Do not edit outside W0.
-- PostgreSQL (Supabase). RLS enabled at the bottom (deny-all by default).
-- v0.3 audit fixes: M1 (NOT NULL on variant/provenance/consent links), M2 (composite FK series integrity),
-- M3 (NOT NULL coin_transactions.user_id).

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  preferred_language TEXT DEFAULT 'en',
  adaptive_opt_in BOOLEAN DEFAULT TRUE,         -- opt-out falls back to director's cut
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------- CONTENT GRAPH ----------
CREATE TABLE series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL, genre TEXT,
  base_language TEXT DEFAULT 'en',
  available_languages TEXT[] DEFAULT '{}',
  cover_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES series(id),
  episode_number INTEGER NOT NULL,
  title TEXT,
  is_free BOOLEAN DEFAULT FALSE,
  coin_cost INTEGER NOT NULL DEFAULT 0,         -- server-authoritative price for a standard unlock
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (id, series_id)                        -- M2: target for the beats composite FK
);
CREATE INDEX idx_episodes_series ON episodes(series_id, episode_number);

CREATE TABLE beats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL,                       -- kept for single-table series reads; integrity via composite FK
  episode_id UUID NOT NULL,
  beat_index INTEGER NOT NULL,
  role TEXT NOT NULL,                            -- spine|hero|variant|connective|ending|cold_open
  canon_facts JSONB DEFAULT '{}',
  is_branch_point BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (episode_id, series_id) REFERENCES episodes(id, series_id)  -- M2: series_id must equal the episode's series
);
CREATE INDEX idx_beats_episode ON beats(episode_id, beat_index);

CREATE TABLE beat_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beat_id UUID NOT NULL REFERENCES beats(id),   -- M1: no orphan variants
  language TEXT NOT NULL DEFAULT 'en',
  accessibility JSONB DEFAULT '{}',             -- {captions,audio_description,sign,contrast,pace}
  intensity SMALLINT DEFAULT 3,                 -- 1..5
  pov TEXT,
  tier TEXT NOT NULL,                           -- A_filmed|B_likeness|C_ai
  is_premium BOOLEAN DEFAULT FALSE,
  coin_cost INTEGER NOT NULL DEFAULT 0,         -- server-authoritative price for a premium variant
  playback_url TEXT NOT NULL,
  duration_ms INTEGER,
  provenance_id UUID,                           -- -> content_credentials (redundant link; enforced from that side)
  qa_status TEXT DEFAULT 'pending',             -- pending|passed|rejected
  placement_slots JSONB DEFAULT '[]'
);
CREATE INDEX idx_variants_beat ON beat_variants(beat_id);

CREATE TABLE beat_edges (
  from_beat_id UUID REFERENCES beats(id),
  to_beat_id UUID REFERENCES beats(id),
  condition JSONB DEFAULT '{}',
  PRIMARY KEY (from_beat_id, to_beat_id)
);

-- ---------- ADAPTIVE STATE ----------
CREATE TABLE viewer_state (
  user_id UUID REFERENCES users(id),
  series_id UUID NOT NULL REFERENCES series(id),
  preference_vector JSONB DEFAULT '{}',
  cohort_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, series_id)              -- KV hot-copy key is the same composite
);

CREATE TABLE decision_log (                     -- append-only; decision_log.id is the decision id
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  beat_id UUID REFERENCES beats(id),
  served_variant_id UUID REFERENCES beat_variants(id),
  is_control BOOLEAN DEFAULT FALSE,
  policy_version TEXT,
  reward JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_decision_user ON decision_log(user_id, created_at);

-- ---------- ECONOMY (ACID) ----------
CREATE TABLE coin_wallet (
  user_id UUID REFERENCES users(id) PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  bonus_balance INTEGER NOT NULL DEFAULT 0 CHECK (bonus_balance >= 0),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE coin_transactions (                -- immutable audit log
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),   -- M3: NOT NULL so PF-5 idempotency holds
  amount INTEGER NOT NULL,                       -- + grant, - spend
  type TEXT NOT NULL,                            -- iap|rewarded_ad|offer_wall|checkin|spend|refund
  client_txn_id TEXT NOT NULL,                   -- idempotency key
  reference_id TEXT,                            -- scope_id of the unlock, or receipt id (polymorphic by design)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, client_txn_id)               -- PF-5: idempotency scoped per user
);

CREATE TABLE entitlements (
  user_id UUID REFERENCES users(id),
  scope TEXT NOT NULL,                           -- 'episode' | 'beat_variant'
  scope_id UUID NOT NULL,                        -- episodes.id or beat_variants.id
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, scope, scope_id)
);

-- Spend RPC contract (W2): idempotent, row-locked, atomic, server-priced.
--   spend_coins(p_user UUID, p_scope TEXT, p_scope_id UUID, p_client_txn_id TEXT)
--   derive cost from episodes.coin_cost or beat_variants.coin_cost; no-op if (p_user, p_client_txn_id) applied;
--   SELECT ... FOR UPDATE on coin_wallet; raise insufficient_funds if balance < cost;
--   INSERT coin_transactions; UPDATE coin_wallet; INSERT entitlements; one transaction. Never trust a client price.

-- ---------- TRUST ----------
CREATE TABLE content_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beat_variant_id UUID NOT NULL REFERENCES beat_variants(id),   -- M1: no orphan provenance
  manifest JSONB NOT NULL,                       -- signed C2PA manifest
  tier TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE consent_ledger (                   -- signed, append-only (NOT a smart contract)
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  likeness_subject TEXT NOT NULL,
  beat_variant_id UUID NOT NULL REFERENCES beat_variants(id),   -- M1: no orphan consent rows
  consent_ref TEXT NOT NULL,
  royalty_terms JSONB,
  prev_hash TEXT, row_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------- RLS floor (deny-all by default; per-service policies land separately) ----------
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE series              ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE beats               ENABLE ROW LEVEL SECURITY;
ALTER TABLE beat_variants       ENABLE ROW LEVEL SECURITY;
ALTER TABLE beat_edges          ENABLE ROW LEVEL SECURITY;
ALTER TABLE viewer_state        ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_wallet         ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_ledger      ENABLE ROW LEVEL SECURITY;
