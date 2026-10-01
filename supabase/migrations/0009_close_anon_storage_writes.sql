-- 0009: close anonymous writes to production storage.
--
-- Live policies (applied out of band in June 2026) let ANYONE with the public anon key upload into the
-- public `videos` bucket under axessplayer/** and the public `thumbnails` bucket under works/**:
--   axessplayer_qa_insert_masters, axessplayer_qa_update_masters  (anon + authenticated, videos/axessplayer/**)
--   reading_works_anon_insert                                     (anon + authenticated, thumbnails/works/**)
-- Server-side writers (generation re-host, ingestion, content posters) use the service-role key, which
-- bypasses RLS, so they keep working. The studio's direct uploads now need a signed-in creator and may only
-- write under axessplayer/uploads/<their auth uid>/**.
--
-- Zone 1 policies and buckets are not touched. Public READ of these public buckets is unchanged.
-- Apply only with the matching deploy (generation service has SUPABASE_SERVICE_ROLE_KEY). Rollback below.

drop policy if exists axessplayer_qa_insert_masters on storage.objects;
drop policy if exists axessplayer_qa_update_masters on storage.objects;
drop policy if exists reading_works_anon_insert on storage.objects;

-- Owner-scoped replacement for signed-in studio uploads (additive).
create policy axessplayer_creator_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = 'axessplayer'
    and (storage.foldername(name))[2] = 'uploads'
    and (storage.foldername(name))[3] = auth.uid()::text
  );

create policy axessplayer_creator_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = 'axessplayer'
    and (storage.foldername(name))[2] = 'uploads'
    and (storage.foldername(name))[3] = auth.uid()::text
  )
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = 'axessplayer'
    and (storage.foldername(name))[2] = 'uploads'
    and (storage.foldername(name))[3] = auth.uid()::text
  );

-- ROLLBACK (restores the exact pre-0009 live policies; run only to undo):
--   drop policy if exists axessplayer_creator_insert_own on storage.objects;
--   drop policy if exists axessplayer_creator_update_own on storage.objects;
--   create policy axessplayer_qa_insert_masters on storage.objects for insert to anon, authenticated
--     with check ((bucket_id = 'videos') and ((storage.foldername(name))[1] = 'axessplayer'));
--   create policy axessplayer_qa_update_masters on storage.objects for update to anon, authenticated
--     using ((bucket_id = 'videos') and ((storage.foldername(name))[1] = 'axessplayer'))
--     with check ((bucket_id = 'videos') and ((storage.foldername(name))[1] = 'axessplayer'));
--   create policy reading_works_anon_insert on storage.objects for insert to anon, authenticated
--     with check ((bucket_id = 'thumbnails') and (name ~~ 'works/%'));
