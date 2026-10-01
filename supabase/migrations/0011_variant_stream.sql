-- 0011: Cloudflare Stream media for beat variants (decision D2). Additive.
-- A Stream-backed variant stores playback_url = 'stream:<uid>' (a marker, not a playable URL); the content
-- service signs a short-lived HLS URL at read time. stream_hls is Stream's own manifest URL from the ready
-- webhook (it carries the account's customer subdomain); stream_status tracks the upload/transcode lifecycle.
alter table beat_variants add column if not exists stream_uid text;
alter table beat_variants add column if not exists stream_hls text;
alter table beat_variants add column if not exists stream_status text
  check (stream_status in ('uploading', 'ready', 'error'));
create unique index if not exists beat_variants_stream_uid_idx on beat_variants(stream_uid) where stream_uid is not null;
