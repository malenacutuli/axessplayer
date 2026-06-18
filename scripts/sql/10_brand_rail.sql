-- 10_brand_rail.sql  (SLICE A: prompt 19 brand revenue rail, services/brand)
--
-- ADDITIVE brand-revenue-rail tables on the mobile overlay schema. This is the data backbone of the brand
-- demand plane: brand/agency accounts, campaigns with targeting + exclusions, the generation-time placement
-- SLOTS (carrying GROUND-TRUTH scene metadata, never CV-reconstructed), the FILLS (each C2PA-signed,
-- Article 50 disclosed, with an immutable audit record), a SEPARATE brand-performance log, and a
-- DOUBLE-ENTRY advertiser billing ledger that brand spend reconciles against.
--
-- HARD GATES honoured by this file (prompt 19 + P10):
--   * CONTENT/AD PLANE FIREWALL: every table here is on the BRAND/AD plane. brand_performance is a SEPARATE
--     performance log; it is NEVER joined to or written from the content reward function (decision/content
--     ranking tables). Re-ranking on this data improves brand-to-scene matching ONLY, on its own objective.
--   * GROUND TRUTH, NOT CV: placement_slots.ground_truth_metadata is authored scene geometry/lighting/
--     surface metadata. No computer-vision zone detection, no viewer tracking, is implied or stored.
--   * PROVENANCE + DISCLOSURE: placement_fills carries c2pa_signed + article50 + an immutable audit jsonb
--     (campaign, creative, targeting snapshot, licensing, provenance). audit rows are append-only.
--   * BILLING reconciles to a DOUBLE-ENTRY ledger; Stripe stays TEST (this schema records ledger entries,
--     it never represents a live charge). Every billing event posts balanced debit+credit lines.
--
-- UNWIRED until applied: until this script is applied, services/brand runs against its in-memory store /
-- the injected BrandDB; nothing here is read by the live services. This file is QUEUED FOR APPLY and is NOT
-- executed by the build. See docs/product/design/SCHEMA_ADDITIVE.md.
--
-- HARD RULES honoured:
--   * ADDITIVE ONLY, "create ... if not exists" / "add column if not exists", safely re-runnable.
--   * Never edits a frozen migration under supabase/migrations/ or anything under contracts/.
--   * NEVER executed against the hosted DB by any tool; written for a human-reviewed apply.
--   * RLS ships a service_role bypass so the brand service (service_role) keeps full access once RLS is on.
--
-- No em dashes anywhere by project rule.

begin;

create schema if not exists mobile;

-- A brand or agency account on the demand side. approval_state gates whether the account may run live fills.
create table if not exists mobile.brand_accounts (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  kind           text not null default 'brand' check (kind in ('brand', 'agency')),
  contact_email  text,
  approval_state text not null default 'pending'
                   check (approval_state in ('pending', 'approved', 'suspended', 'rejected')),
  created_at     timestamptz not null default now()
);

-- A campaign owned by a brand account. targeting is a jsonb spec (country/language/demographic/genre allow
-- lists plus character/scene EXCLUSIONS). deal_model is the commercial model. budget_cents is the cap the
-- pacing + billing ledger reconcile against. status + approval_state gate eligibility for a fill.
create table if not exists mobile.brand_campaigns (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references mobile.brand_accounts (id) on delete cascade,
  product        text not null,
  category       text not null,
  targeting      jsonb not null default '{}'::jsonb,
  deal_model     text not null check (deal_model in ('CPM', 'CPA', 'CPC', 'flat')),
  rate_cents     bigint not null default 0 check (rate_cents >= 0),
  budget_cents   bigint not null default 0 check (budget_cents >= 0),
  spent_cents    bigint not null default 0 check (spent_cents >= 0),
  status         text not null default 'draft'
                   check (status in ('draft', 'active', 'paused', 'archived')),
  approval_state text not null default 'pending'
                   check (approval_state in ('pending', 'approved', 'rejected')),
  freq_cap_per_viewer integer not null default 3 check (freq_cap_per_viewer >= 0),
  created_at     timestamptz not null default now()
);

create index if not exists brand_campaigns_brand_idx on mobile.brand_campaigns (brand_id, created_at desc);
create index if not exists brand_campaigns_active_idx on mobile.brand_campaigns (status, approval_state);

-- A generation-time placement SLOT bound to a series beat. allowed_categories is the brand-category allow
-- list for the slot. canon_constraints is the canon-safety spec (disallowed brand/context pairings).
-- ground_truth_metadata is AUTHORED scene geometry/lighting/surface metadata; it is the structural
-- advantage and is NOT computer-vision reconstructed. No viewer tracking is stored here.
create table if not exists mobile.placement_slots (
  id                   uuid primary key default gen_random_uuid(),
  series_id            uuid not null,
  beat_id              uuid not null,
  allowed_categories   text[] not null default '{}',
  canon_constraints    jsonb not null default '{}'::jsonb,
  ground_truth_metadata jsonb not null default '{}'::jsonb,
  content_rating       text not null default 'PG' check (content_rating in ('G', 'PG', 'PG13', 'R')),
  created_at           timestamptz not null default now()
);

create index if not exists placement_slots_series_idx on mobile.placement_slots (series_id, beat_id);

-- A FILL: a campaign placed into a slot for a region-addressable variant. Each fill is C2PA-signed,
-- Article-50 disclosed where personalized, and carries an IMMUTABLE audit record (campaign, creative,
-- targeting snapshot, licensing, provenance). region makes the fill region-addressable.
create table if not exists mobile.placement_fills (
  id           uuid primary key default gen_random_uuid(),
  slot_id      uuid not null references mobile.placement_slots (id) on delete cascade,
  campaign_id  uuid not null references mobile.brand_campaigns (id) on delete cascade,
  region       text not null default 'GLOBAL',
  viewer_hash  text,                       -- opaque per-viewer key for FREQUENCY CAPS only (not identity, not tracking)
  creative_ref text not null,
  c2pa_signed  boolean not null default false,
  article50    boolean not null default false,
  audit        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists placement_fills_slot_idx on mobile.placement_fills (slot_id, created_at desc);
create index if not exists placement_fills_campaign_idx on mobile.placement_fills (campaign_id, created_at desc);
-- Frequency-cap support: count fills of a campaign for a viewer cheaply.
create index if not exists placement_fills_freq_idx on mobile.placement_fills (campaign_id, viewer_hash);

-- SEPARATE brand-performance log. Same propensity-substrate SHAPE as content engagement events, but on the
-- BRAND plane: it re-ranks brand-to-scene matching ONLY and is NEVER read by the content reward function
-- (the content/ad plane firewall). No personal/biometric fields; these are aggregate placement signals.
create table if not exists mobile.brand_performance (
  id          uuid primary key default gen_random_uuid(),
  fill_id     uuid not null references mobile.placement_fills (id) on delete cascade,
  screen_time double precision not null default 0,
  completion  double precision not null default 0,
  attention   double precision not null default 0,
  propensity  double precision not null default 1,   -- P(fill | slot, ctx) under the matching policy, for off-policy lift on the BRAND objective
  created_at  timestamptz not null default now()
);

create index if not exists brand_performance_fill_idx on mobile.brand_performance (fill_id, created_at desc);

-- DOUBLE-ENTRY advertiser billing ledger. Brand spend reconciles here: every billable event posts a
-- balanced pair of lines (debit the campaign budget account, credit the platform revenue account) under one
-- entry_id. invoice reconciliation SUMS the lines per campaign and asserts debits == credits. TEST MODE
-- only: a row here records a ledger posting, never a live card charge. client_txn_id dedupes a replayed
-- billing event so a retried fill cannot double-bill.
create table if not exists mobile.brand_ledger_entries (
  id            bigserial primary key,
  entry_id      uuid not null,                          -- one economic event = one entry_id = one balanced debit/credit pair
  campaign_id   uuid not null references mobile.brand_campaigns (id) on delete cascade,
  fill_id       uuid references mobile.placement_fills (id) on delete set null,
  account       text not null check (account in ('campaign_budget', 'platform_revenue')),
  direction     text not null check (direction in ('debit', 'credit')),
  amount_cents  bigint not null check (amount_cents >= 0),
  client_txn_id text not null,
  mode          text not null default 'test' check (mode in ('test')),  -- HARD: never 'live'
  created_at    timestamptz not null default now()
);

-- Idempotency: one client_txn_id maps to exactly one balanced posting (two lines share the entry_id).
create unique index if not exists brand_ledger_txn_idx on mobile.brand_ledger_entries (client_txn_id, account);
create index if not exists brand_ledger_campaign_idx on mobile.brand_ledger_entries (campaign_id);

-- RLS: every brand-plane table is authored/read by the brand service under service_role. Ship a service_role
-- bypass so the service keeps full access once RLS is on; advertiser-scoped read policies land with the
-- advertiser identity model (flagged).
do $$
declare t text;
begin
  foreach t in array array[
    'brand_accounts', 'brand_campaigns', 'placement_slots',
    'placement_fills', 'brand_performance', 'brand_ledger_entries'
  ]
  loop
    execute format('alter table mobile.%I enable row level security', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'mobile' and tablename = t
        and policyname = t || '_service_role_all'
    ) then
      execute format(
        'create policy %I on mobile.%I as permissive for all to service_role using (true) with check (true)',
        t || '_service_role_all', t
      );
    end if;
  end loop;
end
$$;

commit;
