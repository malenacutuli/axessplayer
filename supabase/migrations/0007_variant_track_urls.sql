-- 0007_variant_track_urls.sql  (ratified proposal 0009a)
-- Real accessibility track URLs produced by the Axessible pipeline, attached per beat_variant. All nullable,
-- so existing variants keep today's flag-only behavior with no regression. dub_audio_urls is a per-language
-- map { "es": url, ... } so the language chips offer exactly the dubs that exist.
alter table beat_variants add column if not exists caption_doc_url       text;
alter table beat_variants add column if not exists audio_description_url text;
alter table beat_variants add column if not exists sign_video_url        text;
alter table beat_variants add column if not exists dub_audio_urls        jsonb default '{}'::jsonb;
