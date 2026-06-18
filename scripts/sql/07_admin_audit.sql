-- 07_admin_audit.sql  (slice B: admin-api)
--
-- ADDITIVE immutable admin audit log on the mobile overlay schema. Every MUTATING admin request appends
-- exactly one row recording who did what, when, against which target, with before/after JSON snapshots.
-- The admin API's PgAuditSink writes this table.
--
-- DO NOT EXECUTE from any service. This script is written for the main loop / a human operator to apply
-- once against the hosted project. The admin-api service NEVER runs DDL.
--
-- HARD RULES honoured by this file:
--   * ADDITIVE ONLY. "create table if not exists" so the script is safely re-runnable.
--   * Never edits a frozen migration under supabase/migrations/ or anything under contracts/.
--   * APPEND-ONLY: a trigger raises on UPDATE and DELETE so a recorded entry can never be altered or
--     removed. INSERT is the only permitted mutation. RLS ships a service_role bypass for INSERT/SELECT
--     so the writer is never locked out; no per-row owner policy because audit rows have no owner.
--
-- No em dashes anywhere by project rule.

begin;

create schema if not exists mobile;

create table if not exists mobile.admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  ts          timestamptz not null default now(),
  operator_id text not null,
  role        text not null,
  action      text not null,
  target      text not null,
  before      jsonb,
  after       jsonb
);

create index if not exists idx_admin_audit_ts     on mobile.admin_audit_log (ts desc);
create index if not exists idx_admin_audit_target on mobile.admin_audit_log (target);
create index if not exists idx_admin_audit_op     on mobile.admin_audit_log (operator_id, ts desc);

comment on table mobile.admin_audit_log is
  'Append-only admin audit trail. UPDATE and DELETE are forbidden by the trigger below; only INSERT is permitted.';

-- Append-only enforcement: any UPDATE or DELETE raises. The log is immutable by construction, the
-- engineering-ledger discipline applied to operations.
create or replace function mobile.admin_audit_no_mutate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'mobile.admin_audit_log is append-only: % is forbidden', tg_op;
  return null;
end;
$$;

drop trigger if exists trg_admin_audit_no_update on mobile.admin_audit_log;
create trigger trg_admin_audit_no_update
  before update on mobile.admin_audit_log
  for each row execute function mobile.admin_audit_no_mutate();

drop trigger if exists trg_admin_audit_no_delete on mobile.admin_audit_log;
create trigger trg_admin_audit_no_delete
  before delete on mobile.admin_audit_log
  for each row execute function mobile.admin_audit_no_mutate();

alter table mobile.admin_audit_log enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'admin_audit_log'
      and policyname = 'admin_audit_service_role_insert'
  ) then
    create policy admin_audit_service_role_insert on mobile.admin_audit_log
      as permissive for insert to service_role
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'admin_audit_log'
      and policyname = 'admin_audit_service_role_select'
  ) then
    create policy admin_audit_service_role_select on mobile.admin_audit_log
      as permissive for select to service_role
      using (true);
  end if;
end
$$;

commit;
