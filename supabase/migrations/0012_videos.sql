-- 0012: standalone creator videos (platform v2, phase 1). Additive.
-- A video is a single upload of any length and aspect ratio (vertical, horizontal, square) owned by a creator
-- (users.id). Media lives on Cloudflare Stream; orientation, size, and duration come from Stream's ready
-- webhook. format (short | long) is derived at ready time unless the creator chose one. Viewers only ever see
-- published + ready videos. RLS is on with no policies: the table is reached only by the content service's
-- server connection, never through the public API.
create table if not exists videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  language text not null default 'en',
  category text,
  format text check (format in ('short', 'long')),
  orientation text check (orientation in ('vertical', 'horizontal', 'square')),
  width integer,
  height integer,
  duration_ms integer,
  thumbnail_url text,
  visibility text not null default 'draft' check (visibility in ('draft', 'published')),
  published_at timestamptz,
  stream_uid text unique,
  stream_hls text,
  stream_status text check (stream_status in ('uploading', 'ready', 'error')),
  captions jsonb not null default '[]'::jsonb,
  audio_description_url text,
  sign_video_url text,
  dub_audio_urls jsonb not null default '{}'::jsonb,
  sponsor jsonb,
  views bigint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists videos_feed_idx on videos (visibility, stream_status, format, published_at desc);
create index if not exists videos_owner_idx on videos (owner_id, created_at desc);
alter table videos enable row level security;
