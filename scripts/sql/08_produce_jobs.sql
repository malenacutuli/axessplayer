-- 08_produce_jobs.sql  (SLICE B: the content factory executor, services/ingestion)
--
-- ADDITIVE produce-job tables on the mobile overlay schema, backing the JOB API CONTRACT
-- (services/ingestion: POST /produce, GET /jobs, GET /jobs/:id). A produce job records a requested
-- accessibility fan-out (the targets), the computed estimate, and the per-stage DAG status. The
-- ingestion service is UNWIRED until this script is applied: GET /jobs returns an empty list with
-- source:"unwired" and nothing is persisted. This file is QUEUED FOR APPLY and is NOT executed by the
-- build. See docs/product/design/SCHEMA_ADDITIVE.md.
--
-- HARD RULES honoured by this file:
--   * ADDITIVE ONLY, "create table if not exists" / "add column if not exists", safely re-runnable.
--   * Never edits a frozen migration under supabase/migrations/ or anything under contracts/.
--   * NEVER executed against the hosted DB by any tool; written for a human-reviewed apply.
--   * RLS ships a service_role bypass so the live services keep working once RLS is on.
--
-- No em dashes anywhere by project rule.

begin;

create schema if not exists mobile;

-- One produce job: the requested targets, the cost-before-commit estimate, and the lifecycle state.
-- targets is the JOB API CONTRACT request body ({languages[], tracks{cc,ad,sign,dub}, signLanguages[],
-- costTier}) stored verbatim as jsonb so the plan can be recomputed/audited. kind is "produce" for now,
-- left open for future job kinds. state advances queued -> running -> (paused) -> done | failed.
create table if not exists mobile.produce_jobs (
  job_id        text primary key,
  series_id     uuid not null,
  episode_id    uuid,                -- null = the whole series
  kind          text not null default 'produce' check (kind in ('produce')),
  targets       jsonb not null default '{}'::jsonb,
  estimated_usd numeric(10,2) not null default 0,
  state         text not null default 'queued'
                  check (state in ('queued', 'running', 'paused', 'done', 'failed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Idempotency: a repeated produce of the same series+episode+plan derives the same job_id (the API key),
-- so the primary key already de-dupes. This index speeds the GET /jobs listing per series.
create index if not exists produce_jobs_series_idx on mobile.produce_jobs (series_id, created_at desc);

-- One stage in a job's DAG. The contract per-stage shape is {name, status, cost, assetId}. asset_id is set
-- ONLY when a real executor (the auto-produce factory / media-server) produced an asset; it is NEVER
-- fabricated, so a stage with status not 'done' carries a null asset_id. cost is the planned USD estimate.
create table if not exists mobile.produce_job_stages (
  job_id     text not null references mobile.produce_jobs (job_id) on delete cascade,
  name       text not null
               check (name in ('transcript','captions','cwi','ad','dubbing','sign','poster','register','publish')),
  ord        int  not null default 0,         -- DAG order for stable display
  status     text not null default 'pending'
               check (status in ('pending','running','done','failed','skipped')),
  cost       numeric(10,2) not null default 0,
  asset_id   text,                            -- a real produced asset ref, or null when nothing real exists yet
  updated_at timestamptz not null default now(),
  primary key (job_id, name)
);

create index if not exists produce_job_stages_job_idx on mobile.produce_job_stages (job_id, ord);

-- Owner/service RLS: produce is an authoring action driven by the live services (service_role) and the
-- Studio. Ship a service_role bypass so the ingestion service keeps full access once RLS is on; reads for
-- authenticated Studio users are added when the Studio identity model for authoring lands (flagged).
alter table mobile.produce_jobs       enable row level security;
alter table mobile.produce_job_stages enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['produce_jobs', 'produce_job_stages']
  loop
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
