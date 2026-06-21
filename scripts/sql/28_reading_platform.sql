-- 28_reading_platform.sql  (PROMPT 28: the reading platform = demand sensor + IP origination engine)
--
-- ADDITIVE tables on the mobile schema, siblings of the video model (series/beats/beat_variants) on ONE
-- substrate. Reading is the cheapest top of funnel and the demand sensor that de-risks expensive video: a
-- work's reading behavior flows into the SAME engagement_events pipeline as video, produces a demand_score,
-- and a ready_to_adapt work graduates into a mobile.series via the existing beat graph, carrying its consent
-- and provenance forward.
--
-- HARD RULES honoured: additive only, "create ... if not exists", safely re-runnable; never edits a frozen
-- migration; RLS ships a service_role bypass; stays on Supabase Postgres (no new infra). No em dashes.

begin;

create schema if not exists mobile;

-- ===== works: a story (the sibling of mobile.series) =====
create table if not exists mobile.works (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  synopsis            text,
  genre               text,
  language            text not null default 'en',          -- the language this work is written in
  base_language       text not null default 'en',          -- the original authored language
  available_languages text[] not null default array['en'],
  cover_url           text,
  author_id           uuid,                                  -- the creator/publisher (users.id)
  origin              text not null default 'creator_self_publish'
                        check (origin in ('creator_self_publish', 'editorial', 'in_house')),
  status              text not null default 'draft'
                        check (status in ('draft', 'published', 'unpublished')),
  published_at        timestamptz,
  consent_ref         text,                                  -- consent_ledger entry (rights to publish + adapt)
  provenance_id       uuid,                                  -- content_credentials / C2PA provenance
  ai_assisted         boolean not null default false,        -- AI-assisted writing is labeled (Article 50)
  created_at          timestamptz not null default now()
);
create index if not exists works_status_idx on mobile.works (status, published_at desc);
create index if not exists works_author_idx on mobile.works (author_id);

-- ===== chapters: serialized installments of a work =====
create table if not exists mobile.chapters (
  id            uuid primary key default gen_random_uuid(),
  work_id       uuid not null references mobile.works (id) on delete cascade,
  index         integer not null,                            -- 1-based installment order
  title         text,
  body_ref      text,                                        -- pointer to the chapter text in storage
  is_free       boolean not null default false,
  coin_cost     integer not null default 0 check (coin_cost >= 0),
  published_at  timestamptz,
  -- accessibility flags: { dyslexia_layout: bool, audio_edition_url: text, screen_reader_ready: bool }
  accessibility jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (work_id, index)
);
create index if not exists chapters_work_idx on mobile.chapters (work_id, index asc);

-- ===== reading_state: per-reader progress (the sibling of viewer_state) =====
create table if not exists mobile.reading_state (
  user_id       uuid not null,
  work_id       uuid not null references mobile.works (id) on delete cascade,
  chapter_index integer not null default 1,
  percent       double precision not null default 0 check (percent >= 0 and percent <= 1),
  updated_at    timestamptz not null default now(),
  primary key (user_id, work_id)
);
create index if not exists reading_state_work_idx on mobile.reading_state (work_id);

-- ===== adaptation_candidates: the demand sensor verdict per work =====
-- demand_score + signals are computed from reading engagement_events by the demand sensor (same outcome
-- engine as video). status moves testing -> ready_to_adapt -> adapting -> adapted; linked_series_id is set
-- when the work graduates into a mobile.series.
create table if not exists mobile.adaptation_candidates (
  work_id          uuid primary key references mobile.works (id) on delete cascade,
  demand_score     double precision not null default 0,
  -- signals: { completion, reread_rate, share_rate, finish_velocity, by_cohort: {...}, n_readers }
  signals          jsonb not null default '{}'::jsonb,
  status           text not null default 'testing'
                     check (status in ('testing', 'ready_to_adapt', 'adapting', 'adapted')),
  linked_series_id uuid references mobile.series (id),
  updated_at       timestamptz not null default now()
);
create index if not exists adaptation_candidates_status_idx on mobile.adaptation_candidates (status, demand_score desc);

-- ===== RLS: service_role bypass on all four (authored/read by the reading service) =====
alter table mobile.works                 enable row level security;
alter table mobile.chapters              enable row level security;
alter table mobile.reading_state         enable row level security;
alter table mobile.adaptation_candidates enable row level security;

do $$
declare t text; p text;
begin
  for t in select unnest(array['works', 'chapters', 'reading_state', 'adaptation_candidates'])
  loop
    p := t || '_service_role_all';
    if not exists (select 1 from pg_policies where schemaname = 'mobile' and tablename = t and policyname = p) then
      execute format('create policy %I on mobile.%I as permissive for all to service_role using (true) with check (true)', p, t);
    end if;
  end loop;
end $$;

commit;
