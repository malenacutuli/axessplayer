-- 02_auth_profiles.sql  (slice 20-V0)
--
-- ADDITIVE viewer-profile columns on mobile.users, plus owner-scoped RLS keyed on
-- auth.uid() = auth_id. Mirrors the existing mobile overlay schema used by the live
-- services (DB_OPTIONS=-c search_path=mobile,public). See services/content/src/server.ts
-- and docs/product/design/SCHEMA_ADDITIVE.md.
--
-- HARD RULES honoured by this file:
--   * ADDITIVE ONLY. Every statement is "create ... if not exists" or
--     "alter ... add column if not exists", so the script is safely re-runnable.
--   * It NEVER edits a frozen migration under supabase/migrations/ or anything under
--     contracts/. The frozen 0001_init.sql lives in the public schema; this overlay is
--     the isolated mobile schema and is left to the main loop to apply.
--   * RLS is enabled ADDITIVELY: a permissive service_role bypass policy is created so the
--     existing service-role access (the live services connect as a privileged role) is
--     never locked out, alongside the owner-scoped viewer policies.
--
-- No em dashes anywhere by project rule.

begin;

-- The mobile overlay schema and the table the mobile app reads. Created idempotently so this
-- script does not depend on an earlier apply having run. citext powers a case-insensitive
-- unique username; the extension is created if the project does not already carry it.
create schema if not exists mobile;
create extension if not exists citext;

create table if not exists mobile.users (
  id uuid primary key default gen_random_uuid()
);

-- Additive viewer-profile columns.
alter table mobile.users add column if not exists auth_id    uuid;
alter table mobile.users add column if not exists username   citext;
alter table mobile.users add column if not exists avatar_url text;
alter table mobile.users add column if not exists tier       text not null default 'free';
alter table mobile.users add column if not exists created_at timestamptz not null default now();

-- One auth identity maps to one row; usernames are globally unique (case-insensitive via citext).
-- Partial unique indexes so existing rows with NULLs do not collide. Created only when absent.
create unique index if not exists mobile_users_auth_id_key
  on mobile.users (auth_id) where auth_id is not null;
create unique index if not exists mobile_users_username_key
  on mobile.users (username) where username is not null;

-- Enable RLS. This is additive: with RLS on, the privileged service_role still needs an explicit
-- bypass policy (the live services connect as service_role), so we add one before the viewer
-- policies. Without it, enabling RLS would deny the services that already read and write this table.
alter table mobile.users enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'users' and policyname = 'users_service_role_all'
  ) then
    create policy users_service_role_all on mobile.users
      as permissive for all to service_role
      using (true) with check (true);
  end if;

  -- A viewer (authenticated) reads only their own row.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'users' and policyname = 'users_owner_select'
  ) then
    create policy users_owner_select on mobile.users
      as permissive for select to authenticated
      using (auth.uid() = auth_id);
  end if;

  -- A viewer updates only their own row, and cannot reassign it to another auth identity.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'users' and policyname = 'users_owner_update'
  ) then
    create policy users_owner_update on mobile.users
      as permissive for update to authenticated
      using (auth.uid() = auth_id) with check (auth.uid() = auth_id);
  end if;

  -- A viewer inserts only a row that belongs to themselves.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'users' and policyname = 'users_owner_insert'
  ) then
    create policy users_owner_insert on mobile.users
      as permissive for insert to authenticated
      with check (auth.uid() = auth_id);
  end if;
end
$$;

commit;
