-- variant_substrate_additive.sql
--
-- ADDITIVE variant-substrate columns on mobile.beat_variants, per prompt 13 and
-- docs/product/GOLD_STANDARD_13_VARIANT_SUBSTRATE_AND_EVENTS.md (section 1) and
-- docs/product/design/VARIANT_SUBSTRATE.md.
--
-- HARD RULE: this script is ADDITIVE ONLY. It uses idempotent "add column if not exists"
-- statements so it can be applied repeatedly without error. It MUST NEVER edit a frozen
-- migration under supabase/migrations/ or anything under contracts/. This file is not executed
-- by the slice that authored it; it documents the additive DDL ahead of a real migration.
--
-- No em dashes anywhere by project rule.

begin;

-- Variant kind and grouping
alter table mobile.beat_variants add column if not exists variant_kind text;
alter table mobile.beat_variants add column if not exists axis text;
alter table mobile.beat_variants add column if not exists axis_value text;
alter table mobile.beat_variants add column if not exists variant_group text;

-- Localization and accessibility tracks
alter table mobile.beat_variants add column if not exists language text;
alter table mobile.beat_variants add column if not exists caption_doc_url text;
alter table mobile.beat_variants add column if not exists audio_description_url text;
alter table mobile.beat_variants add column if not exists sign_video_url text;
alter table mobile.beat_variants add column if not exists dub_audio_urls jsonb;

-- Monetization state
alter table mobile.beat_variants add column if not exists is_premium boolean not null default false;
alter table mobile.beat_variants add column if not exists coin_cost integer;
alter table mobile.beat_variants add column if not exists entitlement_scope text;

-- Branch state (story graph)
alter table mobile.beat_variants add column if not exists is_branch_point boolean not null default false;
alter table mobile.beat_variants add column if not exists branch_edges jsonb;
alter table mobile.beat_variants add column if not exists branch_conditions jsonb;
alter table mobile.beat_variants add column if not exists is_ending boolean not null default false;

-- Rights state
alter table mobile.beat_variants add column if not exists rights_ref text;
alter table mobile.beat_variants add column if not exists consent_ref text;
alter table mobile.beat_variants add column if not exists royalty_participants jsonb;

-- Provenance, C2PA, and Article 50
alter table mobile.beat_variants add column if not exists provenance_id text;
alter table mobile.beat_variants add column if not exists content_credentials jsonb;
alter table mobile.beat_variants add column if not exists c2pa_signed boolean not null default false;
alter table mobile.beat_variants add column if not exists c2pa_manifest_url text;
alter table mobile.beat_variants add column if not exists article50_ai_label text;

-- Analytics, QA, and playback
alter table mobile.beat_variants add column if not exists analytics_event_mapping jsonb;
alter table mobile.beat_variants add column if not exists qa_status text;
alter table mobile.beat_variants add column if not exists playback_url text;
alter table mobile.beat_variants add column if not exists duration integer;

-- Constrain variant_kind to the canonical set. Added only when absent so the script stays
-- idempotent across repeated applications.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'beat_variants_variant_kind_check'
      and conrelid = 'mobile.beat_variants'::regclass
  ) then
    alter table mobile.beat_variants
      add constraint beat_variants_variant_kind_check
      check (
        variant_kind is null
        or variant_kind in (
          'master', 'ai_cut', 'dub', 'a11y', 'alt_ending',
          'pov', 'intensity', 'brand', 'adapted'
        )
      );
  end if;
end
$$;

commit;
