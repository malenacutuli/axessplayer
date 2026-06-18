-- 12_character_identities.sql  (SLICE B: prompt 17 identity + performance, services/identity-performance)
--
-- ADDITIVE character-identity table on the mobile overlay schema, backing prompt 17 (face/identity lock,
-- lip-sync, de-aging / performance-preservation). One row is the IDENTITY LOCK SPEC for a named character in
-- a series: the reference embeddings + reference images a generated/adapted shot is conditioned on, the voice
-- reference for per-language dub alignment, and the CONSENT reference that ties a real-likeness asset to a
-- current consent-ledger entry (the render precondition, P8).
--
-- SOVEREIGNTY BOUNDARY (prompt 17, hard): biometric reference data is sovereign. This table is intended for
-- the EU/Swiss sovereign plane ONLY; reference_embeddings and reference_image_urls never leave it. On the
-- shared hosted (non-sovereign) project this script stores ONLY non-biometric metadata + opaque references;
-- the embeddings/images columns stay NULL there and the service refuses real-likeness ops behind the founder
-- consent-architecture gate. The columns exist so the sovereign deployment is schema-compatible.
--
-- CONSENT (hard gate, ties to P8): consent_ref points at the CURRENT consent-ledger entry owned by
-- services/trust (the canonical tamper-evident chain). This service does NOT own that table and writes no
-- SQL for it. A row without a current consent_ref is unreachable for real-likeness rendering; revocation
-- HARD-DELETES the identity asset and its derived shots (the purge path lives in the service).
--
-- UNWIRED until applied: until this script is applied, services/identity-performance runs against its
-- injected IdentityStore (in-memory in tests). Nothing here is read by the live services. This file is
-- QUEUED FOR APPLY and is NOT executed by the build.
--
-- HARD RULES honoured by this file:
--   * ADDITIVE ONLY, "create ... if not exists" / "add column if not exists", safely re-runnable.
--   * Never edits a frozen migration under supabase/migrations/ or anything under contracts/.
--   * NEVER executed against the hosted DB by any tool; written for a human-reviewed apply.
--   * RLS ships a service_role bypass so the service (service_role) keeps full access once RLS is on.
--   * BUILT, NOT LIVE: real-likeness operations stay refused until an explicit founder consent-architecture
--     sign-off flips SIGNED_OFF in the service. This schema never self-certifies that gate.
--
-- No em dashes anywhere by project rule.

begin;

create schema if not exists mobile;

-- One identity-lock spec for a character in a series. reference_embeddings / reference_image_urls / voice_ref
-- are the biometric reference material the lock conditions generation on; on the non-sovereign plane they
-- stay NULL. consent_ref is the current consent-ledger reference (P8 render precondition); revoked rows are
-- HARD-DELETED by the service purge path, not soft-flagged.
create table if not exists mobile.character_identities (
  id                   uuid primary key default gen_random_uuid(),
  series_id            uuid not null,
  character_name       text not null,
  reference_embeddings jsonb,
  reference_image_urls text[],
  voice_ref            text,
  consent_ref          text,
  created_at           timestamptz not null default now()
);

-- Read path: identity lookup and drift scoring fetch a character's identity, and a series enumerates its
-- characters. A character_name is unique within a series so the lock is unambiguous per character.
create unique index if not exists character_identities_series_character_idx
  on mobile.character_identities (series_id, character_name);

create index if not exists character_identities_series_idx
  on mobile.character_identities (series_id, created_at asc);

-- Owner/service RLS: identities are authored and read via the sovereign-plane service (service_role). Ship a
-- service_role bypass so the service keeps full access once RLS is on. No authenticated-viewer policy is
-- added: biometric reference data is never viewer-readable (sovereignty boundary).
alter table mobile.character_identities enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'character_identities'
      and policyname = 'character_identities_service_role_all'
  ) then
    execute
      'create policy character_identities_service_role_all on mobile.character_identities '
      || 'as permissive for all to service_role using (true) with check (true)';
  end if;
end
$$;

commit;
