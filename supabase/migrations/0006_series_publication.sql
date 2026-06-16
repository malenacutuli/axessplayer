-- 0006_series_publication.sql  (ratified proposal 0009b)
-- Publish state. published_at is NULL for a draft and set to the go-live time when published. Unpublish sets
-- it back to NULL. The consumer feed lists series with a non-null published_at. Additive and reversible.
alter table series   add column if not exists published_at timestamptz;
alter table episodes add column if not exists published_at timestamptz;
create index if not exists idx_series_published on series (published_at);
