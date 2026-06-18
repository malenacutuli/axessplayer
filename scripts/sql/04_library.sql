-- 04_library.sql  (slice 20-V4)
--
-- ADDITIVE per-viewer library tables on the mobile overlay schema: saved series, favorites
-- (show or character), and downloads, each owner-scoped via RLS so a viewer sees only their
-- own rows. See docs/product/design/SCHEMA_ADDITIVE.md.
--
-- HARD RULES honoured by this file:
--   * ADDITIVE ONLY, "create table if not exists", safely re-runnable.
--   * Never edits a frozen migration under supabase/migrations/ or anything under contracts/.
--   * RLS is additive and ships a service_role bypass policy so existing service-role access is
--     never locked out.
--
-- No em dashes anywhere by project rule.

begin;

create schema if not exists mobile;

-- A series the viewer saved for later.
create table if not exists mobile.saved (
  user_id    uuid not null,
  series_id  uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, series_id)
);

-- A favorited show or character. target_type discriminates which id space target_id lives in.
create table if not exists mobile.favorites (
  user_id     uuid not null,
  target_type text not null check (target_type in ('show', 'character')),
  target_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

-- An offline download bundle for a series, tracking the episode set, byte size, and lifecycle.
create table if not exists mobile.downloads (
  user_id     uuid not null,
  series_id   uuid not null,
  episode_ids uuid[] not null default '{}',
  bytes       bigint not null default 0,
  status      text not null default 'queued',
  created_at  timestamptz not null default now(),
  primary key (user_id, series_id)
);

-- Owner-scoped RLS across all three tables. Each table gets a service_role bypass (so the live
-- services keep working once RLS is on) plus owner read/write for authenticated viewers, matched
-- on the viewer's auth identity via mobile.users.auth_id.
alter table mobile.saved     enable row level security;
alter table mobile.favorites enable row level security;
alter table mobile.downloads enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['saved', 'favorites', 'downloads']
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

    if not exists (
      select 1 from pg_policies
      where schemaname = 'mobile' and tablename = t
        and policyname = t || '_owner_all'
    ) then
      execute format(
        'create policy %I on mobile.%I as permissive for all to authenticated '
        || 'using (auth.uid() = (select u.auth_id from mobile.users u where u.id = %I.user_id)) '
        || 'with check (auth.uid() = (select u.auth_id from mobile.users u where u.id = %I.user_id))',
        t || '_owner_all', t, t, t
      );
    end if;
  end loop;
end
$$;

commit;
