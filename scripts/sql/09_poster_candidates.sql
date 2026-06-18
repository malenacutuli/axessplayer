-- 09_poster_candidates.sql  (SLICE A: 25-D2 dynamic-poster selection, services/experiment)
--
-- ADDITIVE poster-candidate table on the mobile overlay schema, backing the 25-D2 dynamic-poster decision
-- plane. A series owns a poster SET: each row is one poster image tagged by emotion / character / language,
-- plus the load-bearing accessibility_first pin. The decision/experiment plane (GET /poster/select) serves
-- ONE candidate per viewer from this set, chosen by learned CTR on the epsilon-greedy bandit; poster
-- impression + CTR are logged with propensity and feed that bandit.
--
-- UNWIRED until applied: until this script is applied, GET /poster/candidates/:seriesId returns an empty
-- set with source:"unwired" and GET /poster/select falls back to the single series poster_url (treated as
-- the accessibility-first variant). This file is QUEUED FOR APPLY and is NOT executed by the build.
-- See docs/product/design/SCHEMA_ADDITIVE.md.
--
-- HARD RULES honoured by this file:
--   * ADDITIVE ONLY, "create table if not exists" / "add column if not exists", safely re-runnable.
--   * Never edits a frozen migration under supabase/migrations/ or anything under contracts/.
--   * NEVER executed against the hosted DB by any tool; written for a human-reviewed apply.
--   * RLS ships a service_role bypass so the live services keep working once RLS is on.
--
-- HARD GATE (founder sign-off, 25-D2): the bandit optimizes CTR for SELECTION only (a presentation choice).
-- REWARD_WEIGHTS_SIGNED_OFF stays false; no wellbeing/revenue weight is applied. The accessibility-first
-- candidate is ALWAYS eligible and is the guaranteed fallback. Creators NEVER pick per-viewer art; the
-- system selects. This table only stores the candidate SET and its tags; selection lives in code.
--
-- No em dashes anywhere by project rule.

begin;

create schema if not exists mobile;

-- One poster candidate in a series' SET. url is the served poster image. emotion / character / language are
-- descriptive tags a learned viewer taste profile can prefer once the bandit is signed off; while unsigned
-- they are descriptive only and never tilt selection. accessibility_first pins the accessibility-first
-- variant, which the selection core keeps ALWAYS eligible and uses as the guaranteed fallback.
create table if not exists mobile.poster_candidates (
  id                 uuid primary key default gen_random_uuid(),
  series_id          uuid not null,
  url                text not null,
  emotion            text,
  character          text,
  language           text,
  accessibility_first boolean not null default false,
  created_at         timestamptz not null default now()
);

-- Read path: GET /poster/candidates/:seriesId and the per-viewer selection both fetch a series' full SET.
create index if not exists poster_candidates_series_idx
  on mobile.poster_candidates (series_id, created_at asc);

-- A series should have at most one accessibility-first candidate as the guaranteed fallback. Partial unique
-- index enforces that without constraining the rest of the set. Idempotent (if not exists).
create unique index if not exists poster_candidates_one_a11y_per_series
  on mobile.poster_candidates (series_id)
  where accessibility_first;

-- Owner/service RLS: the poster SET is authored via the live services (service_role) and read by the
-- decision/experiment plane. Ship a service_role bypass so those services keep full access once RLS is on;
-- authenticated-viewer read policies are added when the viewer identity model for selection lands (flagged).
alter table mobile.poster_candidates enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'poster_candidates'
      and policyname = 'poster_candidates_service_role_all'
  ) then
    execute
      'create policy poster_candidates_service_role_all on mobile.poster_candidates '
      || 'as permissive for all to service_role using (true) with check (true)';
  end if;
end
$$;

commit;
