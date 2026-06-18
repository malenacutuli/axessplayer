-- 16_storage_policies.sql  (ADDITIVE, NOT executed by the build)
--
-- SLICE B storage RLS for the PUBLIC "videos" bucket. The Studio uploads a 9:16 master DIRECTLY from the
-- browser to storage with the public anon key, then registers its public URL as a beat_variant playback_url.
-- These policies make that path safe: authenticated clients may WRITE into the videos bucket, and ANYONE
-- may READ (the consumer player + the studio preview load the object by its public URL).
--
-- HARD RULE: this file is WRITTEN, never executed here, and lives under scripts/sql (not supabase/migrations).
-- Apply it deliberately against the project when the bucket is provisioned. No em dashes.
--
-- Prereq (run once, out of band): create the public bucket.
--   insert into storage.buckets (id, name, public)
--   values ('videos', 'videos', true)
--   on conflict (id) do update set public = true;

-- RLS is already enabled on storage.objects by Supabase; the policies below are additive.

-- 1. PUBLIC READ: anyone (including anon) may read objects in the videos bucket, so a public storage URL
--    plays for every viewer without a session. Idempotent create.
drop policy if exists "videos public read" on storage.objects;
create policy "videos public read"
  on storage.objects
  for select
  to public
  using (bucket_id = 'videos');

-- 2. AUTHENTICATED UPLOAD: a signed-in (authenticated role) client may insert new objects into the videos
--    bucket. This is the direct browser upload path; the anon key carries the authenticated role only once a
--    creator session is established. Anon-only callers cannot write.
drop policy if exists "videos authenticated upload" on storage.objects;
create policy "videos authenticated upload"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'videos');

-- 3. AUTHENTICATED UPDATE (optional, for re-upload/overwrite of an owned master). Scoped to the videos
--    bucket and the uploading owner so one creator cannot clobber another's master.
drop policy if exists "videos authenticated update own" on storage.objects;
create policy "videos authenticated update own"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'videos' and owner = auth.uid())
  with check (bucket_id = 'videos' and owner = auth.uid());

-- 4. AUTHENTICATED DELETE (optional, prune an owned master). Scoped to the videos bucket and the owner.
drop policy if exists "videos authenticated delete own" on storage.objects;
create policy "videos authenticated delete own"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'videos' and owner = auth.uid());
