-- 26_generation_engine.sql  (PROMPT 26 / GOLD_STANDARD_16: model-agnostic video engine + consistency QA)
--
-- ADDITIVE tables on the mobile overlay schema backing prompt 26: the consistency QA loop's enrolled
-- reference embeddings, the per-shot QA scores, and the cost-metered generation-attempt log. The attempt log
-- + the labeled pass/fail QA scores ARE the defensible IP (the second data flywheel): the accumulated dataset
-- and the tuned QA policy, not the base model.
--
-- These tables persist what services/generation computes in memory today (router pick, consistency score,
-- reject/retry attempts, cost). Until applied, the service runs against its injected in-memory ports (tests);
-- nothing here is read by the live services. QUEUED FOR APPLY, NOT executed by the build.
--
-- SOVEREIGNTY (prompt 17, hard): a FACE reference embedding is biometric and sovereign. On the non-sovereign
-- hosted plane, reference_embeddings rows of kind 'face' stay NULL in the vector column (only the opaque owner
-- reference + the embedder id are stored); the sovereign deployment is schema-compatible. Scene embeddings are
-- not biometric and may be stored on either plane.
--
-- CONSENT + COST (hard gates, enforced in the service, not here): a B_likeness/real-likeness generation needs
-- a current consent-ledger entry (P8, services/trust); every attempt including retries meters against the
-- FinOps budget and a retry over budget is logged state = 'paused_over_budget'. This schema records the
-- outcome; the service decides.
--
-- HARD RULES honoured by this file:
--   * ADDITIVE ONLY, "create ... if not exists", safely re-runnable.
--   * Never edits a frozen migration under supabase/migrations/ or anything under contracts/.
--   * NEVER executed against the hosted DB by any tool; written for a human-reviewed apply.
--   * RLS ships a service_role bypass so the service keeps full access once RLS is on.
--   * BUILT, NOT LIVE / QUEUED FOR APPLY.
--
-- No em dashes anywhere by project rule.

begin;

create schema if not exists mobile;

-- ===== reference_embeddings: the enrolled references the consistency scorer compares a shot against =====
-- owner_type 'character' references a mobile.character_identities row (a face lock); owner_type 'scene' uses
-- an opaque scene key (series_id + scene label). kind mirrors owner_type. embedding holds the vector (NULL on
-- the non-sovereign plane for kind 'face'); model is the embedder id (for example arcface-r100, viclip-b16);
-- dim is the vector length for a fast mismatch check.
create table if not exists mobile.reference_embeddings (
  id          uuid primary key default gen_random_uuid(),
  series_id   uuid not null,
  owner_type  text not null check (owner_type in ('character', 'scene')),
  owner_ref   text not null,
  kind        text not null check (kind in ('face', 'scene')),
  embedding   jsonb,
  model       text not null,
  dim         integer,
  created_at  timestamptz not null default now()
);

create index if not exists reference_embeddings_owner_idx
  on mobile.reference_embeddings (series_id, owner_type, owner_ref);

-- ===== generation_attempts: the cost-metered, retry-tracked attempt log (the second flywheel) =====
-- One row per attempt (including retries). spec_id is the GenerationSpec idempotency key. state carries the
-- cost-gate outcome: a retry refused by the budget lands 'paused_over_budget'. provider/model_handle/model_id
-- record which router pick produced it; cost_usd is what the attempt actually spent (0 on a cache hit or a
-- paused attempt); cached marks a sub-generation cache hit (no double spend).
create table if not exists mobile.generation_attempts (
  id            uuid primary key default gen_random_uuid(),
  spec_id       text not null,
  beat_id       uuid,
  attempt       integer not null,
  provider      text not null,
  model_handle  text not null,
  model_id      text not null,
  output_url    text,
  passed        boolean not null default false,
  reason        text,
  cost_usd      numeric(12, 4) not null default 0,
  cached        boolean not null default false,
  state         text not null default 'done'
                  check (state in ('queued', 'running', 'done', 'failed', 'paused_over_budget')),
  created_at    timestamptz not null default now()
);

create index if not exists generation_attempts_spec_idx
  on mobile.generation_attempts (spec_id, attempt asc);

create index if not exists generation_attempts_beat_idx
  on mobile.generation_attempts (beat_id, created_at asc);

-- ===== qa_scores: the labeled per-shot consistency score (the QA pass-rate + the IP dataset) =====
-- face_cosine / scene_score are the measured similarities (NULL when that dimension was unscorable);
-- thresholds is the TUNED policy in effect for the score (thresholds are not universal, they are config tuned
-- per model/population). passed + reasons is the verdict. Links to the attempt that produced the shot and, once
-- a passed shot is registered, to its beat_variant.
create table if not exists mobile.qa_scores (
  id                    uuid primary key default gen_random_uuid(),
  generation_attempt_id uuid references mobile.generation_attempts (id),
  beat_variant_id       uuid,
  face_cosine           numeric(8, 6),
  scene_score           numeric(8, 6),
  thresholds            jsonb not null,
  passed                boolean not null,
  reasons               text[] not null default '{}',
  created_at            timestamptz not null default now()
);

create index if not exists qa_scores_attempt_idx
  on mobile.qa_scores (generation_attempt_id);

create index if not exists qa_scores_variant_idx
  on mobile.qa_scores (beat_variant_id);

-- ===== RLS: service_role bypass on all three (authored/read by the generation service only) =====
alter table mobile.reference_embeddings enable row level security;
alter table mobile.generation_attempts  enable row level security;
alter table mobile.qa_scores             enable row level security;

do $$
declare
  t text;
  p text;
begin
  for t in select unnest(array['reference_embeddings', 'generation_attempts', 'qa_scores'])
  loop
    p := t || '_service_role_all';
    if not exists (
      select 1 from pg_policies
      where schemaname = 'mobile' and tablename = t and policyname = p
    ) then
      execute format(
        'create policy %I on mobile.%I as permissive for all to service_role using (true) with check (true)',
        p, t
      );
    end if;
  end loop;
end
$$;

commit;
