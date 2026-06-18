-- 13_delight.sql  (SLICE DELIGHT: prompts 25-D3 character inbox + 25-D4 branch-as-quest, services/delight)
--
-- ADDITIVE tables on the mobile overlay schema backing the DELIGHT plane: a scripted/curated in-character
-- "inbox" that a character uses to reach a viewer after an episode (25-D3), and an anti-dark-pattern
-- "branch-as-quest" that unlocks a narrative branch through any of several earned paths (25-D4).
--
-- BUILT, NOT LIVE. Until this script is applied by a human reviewer, services/delight runs entirely against
-- its injected in-memory store (the test default). Nothing here is read by the 5 live services. This file is
-- QUEUED FOR APPLY and is NOT executed by any build tool.
--
-- HARD RULES honoured by this file:
--   * ADDITIVE ONLY: "create ... if not exists" / "add column if not exists", safely re-runnable.
--   * Never edits a frozen migration under supabase/migrations/ or anything under contracts/.
--   * NEVER executed against the hosted DB by any tool; written for a human-reviewed apply.
--   * RLS ships a service_role bypass so the service (service_role) keeps full access once RLS is on.
--   * No em dashes anywhere by project rule.
--
-- CONSENT / DISCLOSURE (25-D3, hard):
--   * Every inbox message is grounded in a CONSENTED actor: consent_ref points at the CURRENT consent-ledger
--     entry owned by services/trust (this service does NOT own that table; revocation is enforced in the
--     service gate). A message without a current consent_ref is unreachable.
--   * Synthetic audio (a voice note) is C2PA-signed: c2pa_ref is the opaque signature reference (interface
--     to the signing plane). A voice note row without a c2pa_ref is invalid.
--   * ai_disclosure is NOT NULL and DEFAULT true: a persistent "this is an AI character" disclosure flag is
--     carried on EVERY message. The service never emits a message with the flag cleared.
--   * AGE GATE: a thread carries mature_mode; the service BLOCKS a minor from a mature/romantic thread. The
--     viewer age class is resolved by interface (identity plane), never trusted from the client.

begin;

create schema if not exists mobile;

-- ---------------------------------------------------------------------------------------------------------
-- 25-D3: character inbox
-- ---------------------------------------------------------------------------------------------------------

-- A thread is a per-viewer, per-character conversation surface opened after an episode. mature_mode marks a
-- mature/romantic thread that the age gate restricts. There is one open thread per (user, character, series).
create table if not exists mobile.inbox_threads (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  character_id   text not null,
  series_id      uuid,
  mature_mode    boolean not null default false,
  created_at     timestamptz not null default now()
);

create unique index if not exists inbox_threads_user_character_series_idx
  on mobile.inbox_threads (user_id, character_id, coalesce(series_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists inbox_threads_user_idx
  on mobile.inbox_threads (user_id, created_at desc);

-- A message is a single scripted/curated in-character beat. kind is one of: text, voice_note (synthetic
-- audio, C2PA-signed), secret_clue (PAID, spend cool-down + idempotent), choose_next (applies a branch via
-- the decision plane). consent_ref ties the message to a CONSENTED actor; c2pa_ref is the synthetic-audio
-- signature reference (required for voice_note); ai_disclosure is the persistent "AI character" flag carried
-- on every message and is never cleared by the service.
create table if not exists mobile.inbox_messages (
  id             uuid primary key default gen_random_uuid(),
  thread_id      uuid not null references mobile.inbox_threads (id),
  user_id        uuid not null,
  character_id   text not null,
  kind           text not null check (kind in ('text', 'voice_note', 'secret_clue', 'choose_next')),
  body           text,
  audio_url      text,
  branch_id      text,
  consent_ref    text not null,
  c2pa_ref       text,
  ai_disclosure  boolean not null default true,
  paid           boolean not null default false,
  created_at     timestamptz not null default now(),
  -- a voice note must carry its C2PA signature reference; a paid clue must name a branch context
  constraint inbox_messages_voice_signed check (kind <> 'voice_note' or c2pa_ref is not null),
  constraint inbox_messages_disclosure_present check (ai_disclosure is true)
);

create index if not exists inbox_messages_thread_idx
  on mobile.inbox_messages (thread_id, created_at asc);

create index if not exists inbox_messages_user_idx
  on mobile.inbox_messages (user_id, created_at desc);

-- ---------------------------------------------------------------------------------------------------------
-- 25-D4: branch-as-quest
-- ---------------------------------------------------------------------------------------------------------

-- Per-viewer progress toward unlocking a branch. unlocked flips true the first time any path is satisfied
-- (invite first-watch, watch-ad-for-clue, spend credits, or the community goal reaching target). The
-- satisfied_path records which path did it. paths_seen is the audit set of paths a viewer has earned, used
-- to enforce no self-referral and idempotency.
create table if not exists mobile.quest_progress (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  branch_id      text not null,
  unlocked       boolean not null default false,
  satisfied_path text,
  paths_seen     text[] not null default '{}',
  updated_at     timestamptz not null default now()
);

create unique index if not exists quest_progress_user_branch_idx
  on mobile.quest_progress (user_id, branch_id);

-- A community goal aggregates contributions ACROSS viewers toward a branch. current_count rises as viewers
-- contribute; when current_count >= target_count the goal is met and the branch unlocks for everyone. A
-- contribution carries a contributor key so a contribution is idempotent per (goal, contributor) and never
-- self-referral-inflated.
create table if not exists mobile.community_goals (
  id             uuid primary key default gen_random_uuid(),
  branch_id      text not null unique,
  target_count   integer not null check (target_count > 0),
  current_count  integer not null default 0,
  contributors   text[] not null default '{}',
  met            boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists community_goals_branch_idx
  on mobile.community_goals (branch_id);

-- ---------------------------------------------------------------------------------------------------------
-- RLS: authored and read via the service (service_role). Ship a service_role bypass on every table so the
-- service keeps full access once RLS is on. A viewer-readable policy is intentionally NOT added here: the
-- service mediates every read (the inbox read is self-scoped and disclosure-stamped in the service).
-- ---------------------------------------------------------------------------------------------------------
alter table mobile.inbox_threads   enable row level security;
alter table mobile.inbox_messages  enable row level security;
alter table mobile.quest_progress  enable row level security;
alter table mobile.community_goals enable row level security;

do $$
declare
  t text;
  p text;
begin
  for t in select unnest(array['inbox_threads', 'inbox_messages', 'quest_progress', 'community_goals'])
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
