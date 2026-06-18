-- 05_referrals.sql  (slice 20-V7)
--
-- ADDITIVE referral ledger on the mobile overlay schema. Tracks an invite code, the inviter, the
-- invitee, the funnel status, and whether a reward was granted. Owner-scoped RLS so a viewer sees
-- only referrals they took part in. See docs/product/design/SCHEMA_ADDITIVE.md.
--
-- HARD RULES honoured by this file:
--   * ADDITIVE ONLY, "create table if not exists" / guarded "add constraint", safely re-runnable.
--   * Never edits a frozen migration under supabase/migrations/ or anything under contracts/.
--   * RLS is additive and ships a service_role bypass policy so existing service-role access is
--     never locked out.
--   * GATE: reward_granted is a neutral bookkeeping flag, not an optimization target. No revenue or
--     extraction objective is encoded here; reward weights remain DRAFT and display-only.
--
-- GUARD: a viewer must never refer themselves. The inviter_id <> invitee_id self-referral guard is
-- enforced by the table-level check constraint below (referrals_no_self_referral), evaluated only
-- when both ids are present so an invite that has not yet been accepted (invitee_id null) is allowed.
--
-- No em dashes anywhere by project rule.

begin;

create schema if not exists mobile;

create table if not exists mobile.referrals (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,
  inviter_id     uuid not null,
  invitee_id     uuid,
  status         text not null default 'invited' check (status in ('invited', 'joined', 'first_watch')),
  reward_granted boolean not null default false,
  created_at     timestamptz not null default now()
);

-- One row per accepted invitee: an invitee can be claimed by at most one referral. Partial unique
-- so multiple still-open invites (invitee_id null) under one code do not collide.
create unique index if not exists mobile_referrals_invitee_key
  on mobile.referrals (invitee_id) where invitee_id is not null;

-- Guarded additive constraints (idempotent): self-referral guard and a non-empty code check.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'referrals_no_self_referral'
      and conrelid = 'mobile.referrals'::regclass
  ) then
    -- GUARD: prevent self-referral. NULL invitee_id (open invite) passes the check.
    alter table mobile.referrals
      add constraint referrals_no_self_referral
      check (invitee_id is null or inviter_id <> invitee_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'referrals_code_not_blank'
      and conrelid = 'mobile.referrals'::regclass
  ) then
    alter table mobile.referrals
      add constraint referrals_code_not_blank
      check (length(code) > 0);
  end if;
end
$$;

-- RLS: a viewer sees referrals where they are either the inviter or the invitee. service_role keeps
-- full access so the live services can grant rewards and advance status server-side.
alter table mobile.referrals enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'referrals'
      and policyname = 'referrals_service_role_all'
  ) then
    create policy referrals_service_role_all on mobile.referrals
      as permissive for all to service_role
      using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'referrals'
      and policyname = 'referrals_participant_select'
  ) then
    create policy referrals_participant_select on mobile.referrals
      as permissive for select to authenticated
      using (
        auth.uid() = (select u.auth_id from mobile.users u where u.id = referrals.inviter_id)
        or auth.uid() = (select u.auth_id from mobile.users u where u.id = referrals.invitee_id)
      );
  end if;

  -- A viewer may create an invite only as the inviter (and never targeting themselves; the table
  -- check constraint backstops the self-referral guard regardless of role).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'referrals'
      and policyname = 'referrals_inviter_insert'
  ) then
    create policy referrals_inviter_insert on mobile.referrals
      as permissive for insert to authenticated
      with check (auth.uid() = (select u.auth_id from mobile.users u where u.id = referrals.inviter_id));
  end if;
end
$$;

commit;
