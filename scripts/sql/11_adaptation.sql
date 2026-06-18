-- 11_adaptation.sql  (SLICE A: AI live-action adaptation, services/adaptation, prompt 23)
--
-- ADDITIVE adaptation tables on the mobile overlay schema, backing the ADAPTATION API
-- (services/adaptation: POST /analyze, POST /jobs, GET /jobs/:id, POST /jobs/:id/approve).
-- An adaptation takes archive footage the studio OWNS/CONTROLS and produces tier-classified
-- derivative variants, editing existing pixels wherever possible and NEVER blind-regenerating.
-- Every output registers as a beat_variant with source_type='adapted_archive' carrying full
-- provenance (source id, time range, transformation, prompt, adapters, consent/rights, C2PA,
-- Article 50, cost, reviewer). This file documents that DDL ahead of a real migration.
--
-- HARD RULES honoured by this file:
--   * ADDITIVE ONLY: "create table if not exists" / "add column if not exists", safely re-runnable.
--   * Never edits a frozen migration under supabase/migrations/ or anything under contracts/.
--   * NEVER executed against the hosted DB by any tool; written for a human-reviewed apply.
--   * RLS ships a service_role bypass so the live services keep working once RLS is on.
--   * The RIGHTS/CONSENT gate is a HARD block: no adaptation row may advance past rights_gate
--     unless its adaptation_rights_gate row is overall='green'.
--
-- No em dashes anywhere by project rule.

begin;

create schema if not exists mobile;

-- ---------------------------------------------------------------------------------------------------
-- adaptation_source : the archive asset to adapt. The studio must OWN or CONTROL this footage; that
-- claim is checked in adaptation_rights_gate. probe_* are filled by the technical_probe stage.
-- ---------------------------------------------------------------------------------------------------
create table if not exists mobile.adaptation_source (
  source_id     text primary key,
  owner_user_id uuid,                       -- the studio account that asserts control of the footage
  series_id     uuid,                        -- optional: target series the adaptation lands under
  asset_url     text not null,               -- the archive master (read only; never overwritten)
  title         text,
  is_hero       boolean not null default false,  -- hero content: Tier C is NEVER auto, always reviewed
  probe_width   integer,
  probe_height  integer,
  probe_fps     numeric(8,3),
  probe_duration_ms integer,
  probe_codec   text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------------
-- adaptation_job : one enqueued tiered action over a source. The DAG advances stage by stage; state
-- is the coarse lifecycle. tier and capability pin which AdaptationAdapter runs. confidence is the
-- scorer output (high -> one-click, medium -> preview+review, low -> require prompt/human edit).
-- ---------------------------------------------------------------------------------------------------
create table if not exists mobile.adaptation_job (
  job_id        text primary key,
  source_id     text not null references mobile.adaptation_source(source_id),
  capability    text not null,               -- e.g. vertical_reframe, captioning, audio_description
  tier          text not null check (tier in ('A', 'B', 'C')),
  confidence    text not null default 'low' check (confidence in ('high', 'medium', 'low')),
  confidence_score numeric(4,3) not null default 0,
  state         text not null default 'queued'
                  check (state in ('queued', 'running', 'blocked', 'awaiting_review',
                                   'paused_over_budget', 'done', 'failed', 'rejected')),
  current_stage text,                          -- the DAG node currently pending/running
  estimated_usd numeric(10,2) not null default 0,
  prompt        text,                          -- the operator prompt for low-confidence / Tier C work
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_adaptation_job_source on mobile.adaptation_job(source_id);

-- ---------------------------------------------------------------------------------------------------
-- adaptation_plan : the analysis output of POST /analyze. Scores + a scene timeline + the proposed
-- tiered actions. One plan per analyze pass; a job may reference the plan it was enqueued from.
-- ---------------------------------------------------------------------------------------------------
create table if not exists mobile.adaptation_plan (
  plan_id       text primary key,
  source_id     text not null references mobile.adaptation_source(source_id),
  scores        jsonb not null default '{}'::jsonb,   -- per-capability confidence + reliability tier
  proposed      jsonb not null default '[]'::jsonb,   -- [{capability, tier, confidence, estimatedUsd}]
  created_at    timestamptz not null default now()
);

-- adaptation_scene : the detected scene timeline for a source (scene_detection stage output).
create table if not exists mobile.adaptation_scene (
  scene_id      text primary key,
  source_id     text not null references mobile.adaptation_source(source_id),
  idx           integer not null,
  start_ms      integer not null,
  end_ms        integer not null,
  shot_class    text,                          -- wide | medium | close | insert (shot_classification)
  has_face      boolean,
  has_logo      boolean,
  created_at    timestamptz not null default now()
);
create index if not exists idx_adaptation_scene_source on mobile.adaptation_scene(source_id, idx);

-- adaptation_instruction : one concrete, constrained edit the adapter will apply (edit pixels, do not
-- regenerate). kind mirrors the capability; params is the adapter-specific, validated payload.
create table if not exists mobile.adaptation_instruction (
  instruction_id text primary key,
  job_id        text not null references mobile.adaptation_job(job_id),
  scene_id      text references mobile.adaptation_scene(scene_id),
  kind          text not null,
  params        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- adaptation_variant : the registered output. Mirrors a beat_variant with source_type='adapted_archive'
-- and the full provenance bundle. This is what the content plane reads once the variant is published.
create table if not exists mobile.adaptation_variant (
  variant_id    text primary key,
  job_id        text not null references mobile.adaptation_job(job_id),
  source_id     text not null references mobile.adaptation_source(source_id),
  beat_id       uuid,                          -- the target beat, when landed under a series graph
  source_type   text not null default 'adapted_archive'
                  check (source_type = 'adapted_archive'),
  playback_url  text,
  source_range_start_ms integer,
  source_range_end_ms   integer,
  transformation text not null,                -- the capability applied
  prompt        text,
  adapters      jsonb not null default '[]'::jsonb,   -- [{id, capability}]
  consent_ref   text,
  rights_ref    text,
  c2pa_signed   boolean not null default false,
  c2pa_manifest_url text,
  article50_ai_label text,
  cost_usd      numeric(10,2) not null default 0,
  reviewer      text,                          -- the human gate that approved a Tier B/C variant
  qa_status     text not null default 'pending'
                  check (qa_status in ('pending', 'passed', 'rejected')),
  created_at    timestamptz not null default now()
);
create index if not exists idx_adaptation_variant_job on mobile.adaptation_variant(job_id);

-- adaptation_review : the human review gate ledger. A Tier B variant needs QA; a Tier C variant needs
-- a MANDATORY human review and may never auto-render on hero content. revocation purges variants by
-- revoking the source's consent (see adaptation_rights_gate), recorded here as decision='revoked'.
create table if not exists mobile.adaptation_review (
  review_id     text primary key,
  job_id        text not null references mobile.adaptation_job(job_id),
  reviewer      text not null,
  decision      text not null check (decision in ('approved', 'rejected', 'revoked')),
  low_confidence_flagged boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now()
);

-- adaptation_rights_gate : the HARD block before ANY adaptation. The checklist plus the overall
-- Green/Yellow/Red. overall='green' is required to advance past the rights_gate DAG node. No likeness
-- or voice adaptation without current consent; a revocation flips consent_current=false and triggers
-- a purge of the adapted variants. Wired to the consent ledger (services/trust) by interface.
create table if not exists mobile.adaptation_rights_gate (
  source_id     text primary key references mobile.adaptation_source(source_id),
  owns_footage          boolean not null default false,
  actor_adaptation_rights boolean not null default false,
  voice_rights          boolean not null default false,
  likeness_rights       boolean not null default false,
  music_rights          boolean not null default false,
  territory_cleared     boolean not null default false,
  brand_logo_cleared    boolean not null default false,
  ai_transformation_allowed boolean not null default false,
  age_sensitive_reviewed boolean not null default false,
  consent_ref           text,                  -- the consent_ledger reference (by interface)
  consent_current       boolean not null default false,
  overall               text not null default 'red' check (overall in ('green', 'yellow', 'red')),
  updated_at            timestamptz not null default now()
);

-- adaptation_cost_estimate : the cost-before-commit gate. estimated_usd vs budget_usd; over_budget
-- pauses the job (state='paused_over_budget') rather than spending.
create table if not exists mobile.adaptation_cost_estimate (
  estimate_id   text primary key,
  job_id        text not null references mobile.adaptation_job(job_id),
  estimated_usd numeric(10,2) not null default 0,
  budget_usd    numeric(10,2),
  over_budget   boolean not null default false,
  breakdown     jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- RLS: enable with a service_role bypass so the live services keep working once RLS is switched on.
do $$
declare t text;
begin
  foreach t in array array[
    'adaptation_source', 'adaptation_job', 'adaptation_plan', 'adaptation_scene',
    'adaptation_instruction', 'adaptation_variant', 'adaptation_review',
    'adaptation_rights_gate', 'adaptation_cost_estimate'
  ] loop
    execute format('alter table mobile.%I enable row level security', t);
    execute format(
      'drop policy if exists %I on mobile.%I', t || '_service_role_all', t);
    execute format(
      'create policy %I on mobile.%I for all to service_role using (true) with check (true)',
      t || '_service_role_all', t);
  end loop;
end $$;

commit;
