-- 03_channels.sql  (slice 20-V2)
--
-- ADDITIVE channel taxonomy on the mobile overlay schema: channels, the series<->channel join,
-- and per-viewer follows with owner-scoped RLS. Seeds the 9 launch channels idempotently.
-- See docs/product/design/SCHEMA_ADDITIVE.md.
--
-- HARD RULES honoured by this file:
--   * ADDITIVE ONLY. "create table if not exists" / "insert ... on conflict do nothing", so the
--     script is safely re-runnable.
--   * Never edits a frozen migration under supabase/migrations/ or anything under contracts/.
--   * RLS on channel_follows is additive and ships a service_role bypass policy so existing
--     service-role access is never locked out.
--
-- No em dashes anywhere by project rule.

begin;

create schema if not exists mobile;

-- A browsable channel (a genre-ish surface the viewer can follow).
create table if not exists mobile.channels (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique,
  name        text,
  description text,
  genres      text[],
  hero_url    text
);

-- Many-to-many: a series can appear in several channels. No FK to the frozen series table so this
-- overlay stays self-contained and additive; integrity is enforced at the service layer.
create table if not exists mobile.series_channels (
  series_id  uuid not null,
  channel_id uuid not null,
  primary key (series_id, channel_id)
);

-- A viewer follows a channel, optionally muting notifications.
create table if not exists mobile.channel_follows (
  user_id    uuid not null,
  channel_id uuid not null,
  notify     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

-- Seed the 9 launch channels. ON CONFLICT DO NOTHING on the unique slug keeps this idempotent.
insert into mobile.channels (slug, name) values
  ('telenovela', 'Telenovela'),
  ('crime',      'Crime'),
  ('thriller',   'Thriller'),
  ('reality',    'Reality'),
  ('cooking',    'Cooking'),
  ('podcasts',   'Podcasts'),
  ('education',  'Education'),
  ('children',   'Children'),
  ('drama',      'Drama')
on conflict (slug) do nothing;

-- RLS on channel_follows: viewers see and manage only their own follows. channels and
-- series_channels are catalog data read by the services and are left without per-viewer RLS here
-- (they carry no personal data); enabling RLS on them is deferred to a catalog-read policy slice.
alter table mobile.channel_follows enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'channel_follows'
      and policyname = 'channel_follows_service_role_all'
  ) then
    create policy channel_follows_service_role_all on mobile.channel_follows
      as permissive for all to service_role
      using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'channel_follows'
      and policyname = 'channel_follows_owner_select'
  ) then
    create policy channel_follows_owner_select on mobile.channel_follows
      as permissive for select to authenticated
      using (auth.uid() = (select u.auth_id from mobile.users u where u.id = channel_follows.user_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'channel_follows'
      and policyname = 'channel_follows_owner_write'
  ) then
    create policy channel_follows_owner_write on mobile.channel_follows
      as permissive for all to authenticated
      using (auth.uid() = (select u.auth_id from mobile.users u where u.id = channel_follows.user_id))
      with check (auth.uid() = (select u.auth_id from mobile.users u where u.id = channel_follows.user_id));
  end if;
end
$$;

commit;
