-- 15_companions.sql  (SLICE COMPANIONS: prompt 16 AI companions, services/companions)
--
-- ADDITIVE companion tables on the mobile overlay schema, backing prompt 16 (AI companions: consented-actor
-- character chat). A companion is an LLM chat grounded in a series character's persona, with per-user memory
-- and a trust-meter progression that unlocks content. This is the HIGHEST WELLBEING RISK surface in the
-- product and is GATED: it is surfaced for founder review before any live companion.
--
-- CONSENT (hard gate, ties to P8): actor_consent_ref points at the CURRENT likeness/voice consent-ledger
-- entry owned by services/trust (the canonical tamper-evident chain). This service does NOT own that table
-- and writes NO SQL for it. A companion is UNREACHABLE unless the actor's likeness/voice consent is present
-- and unrevoked. Revocation HARD-DELETES the companion and its derived assets (the purge path lives in the
-- service); it is never soft-flagged.
--
-- WELLBEING BOUNDARY (hard, prompt 16): no compulsive-dependency engineering, no "you will lose the
-- relationship" dark patterns, a spend cool-down, a persistent "this is an AI character" disclosure, and an
-- age-gate (minors are blocked from mature/romantic companion modes entirely). These are enforced in the
-- service; the schema only carries the metadata (persona mode, royalty terms, status) the service reasons
-- over.
--
-- PROVENANCE (hard): every synthetic companion turn is C2PA-signed and EU AI Act Article-50 labeled as
-- AI-generated. The signature/label material is attached to the message row (synthetic turns only).
--
-- UNWIRED until applied: until this script is applied, services/companions runs against its injected
-- in-memory store (tests + local wiring). Nothing here is read by the live services. QUEUED FOR APPLY and
-- NOT executed by the build.
--
-- HARD RULES honoured by this file:
--   * ADDITIVE ONLY, "create ... if not exists" / "add column if not exists", safely re-runnable.
--   * Never edits a frozen migration under supabase/migrations/ or anything under contracts/.
--   * NEVER executed against the hosted DB by any tool; written for a human-reviewed apply.
--   * RLS ships a service_role bypass so the service (service_role) keeps full access once RLS is on.
--   * BUILT, NOT LIVE: companions stay unreachable until an explicit founder sign-off flips SIGNED_OFF in
--     the service. This schema never self-certifies that gate.
--
-- No em dashes anywhere by project rule.

begin;

create schema if not exists mobile;

-- One companion: a chat persona grounded in a named series character. actor_consent_ref is the CURRENT
-- likeness/voice consent-ledger reference (the reachability precondition); a row whose consent is absent or
-- revoked is unreachable and is HARD-DELETED by the service purge path on revocation. persona carries the
-- grounding (system prompt, traits, allowed topics, the per-companion mode such as "general" or "mature").
-- voice_ref is the consented voice asset reference; royalty_terms carries the actor royalty split applied to
-- any monetized turn (paid via the ledger interface, within the anti-dark-pattern policy). status is the
-- lifecycle flag (draft | active | revoked).
create table if not exists mobile.companions (
  id                 uuid primary key default gen_random_uuid(),
  series_id          uuid not null,
  character_name     text not null,
  actor_consent_ref  text,
  persona            jsonb not null default '{}'::jsonb,
  voice_ref          text,
  royalty_terms      jsonb not null default '{}'::jsonb,
  status             text not null default 'draft',
  created_at         timestamptz not null default now()
);

-- One companion per character within a series so grounding is unambiguous.
create unique index if not exists companions_series_character_idx
  on mobile.companions (series_id, character_name);

-- A chat session between a viewer and a companion. trust_level is the trust-meter progression (a bounded,
-- non-compulsive counter that unlocks deeper persona content); the service caps it and never engineers
-- dependency. mode is the active conversation mode (age-gated: a minor session can never be "mature").
-- spend_cooldown_until enforces the wellbeing spend cool-down across turns.
create table if not exists mobile.companion_sessions (
  id                    uuid primary key default gen_random_uuid(),
  companion_id          uuid not null references mobile.companions(id) on delete cascade,
  user_id               uuid not null,
  trust_level           integer not null default 0,
  mode                  text not null default 'general',
  memory                jsonb not null default '{}'::jsonb,
  spend_cooldown_until  timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists companion_sessions_user_idx
  on mobile.companion_sessions (user_id, created_at desc);

create index if not exists companion_sessions_companion_idx
  on mobile.companion_sessions (companion_id, created_at desc);

-- A single chat turn. role is 'user' or 'companion'. SYNTHETIC TURNS (role = 'companion') carry the
-- PROVENANCE material: c2pa_signature (TEST signer until the KMS cutover) and ai_label (the persistent
-- Article-50 "this is an AI character" disclosure). A synthetic turn without both is invalid and is never
-- written by the service.
create table if not exists mobile.companion_messages (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references mobile.companion_sessions(id) on delete cascade,
  role            text not null,
  content         text not null,
  c2pa_signature  text,
  ai_label        text,
  created_at      timestamptz not null default now()
);

create index if not exists companion_messages_session_idx
  on mobile.companion_messages (session_id, created_at asc);

-- Owner/service RLS: companions are authored and read via the service (service_role). Ship a service_role
-- bypass so the service keeps full access once RLS is on. No authenticated-viewer policy is added here: the
-- consent + founder + age gates are enforced in the service, not by a row policy, so a viewer never reads a
-- companion row directly.
alter table mobile.companions enable row level security;
alter table mobile.companion_sessions enable row level security;
alter table mobile.companion_messages enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'companions'
      and policyname = 'companions_service_role_all'
  ) then
    execute
      'create policy companions_service_role_all on mobile.companions '
      || 'as permissive for all to service_role using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'companion_sessions'
      and policyname = 'companion_sessions_service_role_all'
  ) then
    execute
      'create policy companion_sessions_service_role_all on mobile.companion_sessions '
      || 'as permissive for all to service_role using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'companion_messages'
      and policyname = 'companion_messages_service_role_all'
  ) then
    execute
      'create policy companion_messages_service_role_all on mobile.companion_messages '
      || 'as permissive for all to service_role using (true) with check (true)';
  end if;
end
$$;

commit;
