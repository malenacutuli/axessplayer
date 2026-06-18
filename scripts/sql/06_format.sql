-- 06_format.sql  (slice 20)
--
-- ADDITIVE content-format tag on the series table in the mobile overlay schema. format classifies a
-- title as a Series, a Podcast, or a Film so the browse surfaces can group and filter by kind.
-- See docs/product/design/SCHEMA_ADDITIVE.md.
--
-- WHICH TABLE: the frozen migration supabase/migrations/0001_init.sql defines public.series, which is
-- FROZEN and must not be edited. The live mobile app reads through the mobile overlay schema
-- (DB_OPTIONS=-c search_path=mobile,public), so the additive column belongs on mobile.series. This
-- script targets mobile.series, creating a minimal stub table if the overlay has not been
-- materialized yet, so the column add never fails on a fresh apply.
--
-- HARD RULES honoured by this file:
--   * ADDITIVE ONLY, "create table if not exists" / "add column if not exists" / guarded constraint,
--     safely re-runnable.
--   * Never edits a frozen migration under supabase/migrations/ or anything under contracts/.
--
-- No em dashes anywhere by project rule.

begin;

create schema if not exists mobile;

-- Minimal stub so the column add below is safe on a cold overlay. If mobile.series already exists
-- (the real overlay), this is a no-op.
create table if not exists mobile.series (
  id uuid primary key default gen_random_uuid()
);

-- The additive format tag. Defaults to 'Series' so existing rows classify sensibly.
alter table mobile.series add column if not exists format text not null default 'Series';

-- Constrain to the canonical set. Added only when absent so the script stays idempotent.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'series_format_check'
      and conrelid = 'mobile.series'::regclass
  ) then
    alter table mobile.series
      add constraint series_format_check
      check (format in ('Series', 'Podcast', 'Film'));
  end if;
end
$$;

commit;
