-- 28b_reading_works_storage_policy.sql  (PROMPT 28: durable full-text storage for serialized chapters)
--
-- Scoped anon INSERT on the public thumbnails bucket under works/** so a chapter's full text is stored as a
-- durable object that chapters.body_ref points to (the schema intent: body_ref is a pointer to text storage,
-- not inline text). Read is already public on thumbnails; this adds INSERT only, under the works/ prefix,
-- mirroring the existing videos/axessplayer/** authoring policy. No update/delete granted. Applied live as
-- migration reading_works_storage_policy. No em dashes.

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='reading_works_anon_insert') then
    create policy reading_works_anon_insert on storage.objects
      as permissive for insert to anon, authenticated
      with check (bucket_id = 'thumbnails' and name like 'works/%');
  end if;
end $$;
