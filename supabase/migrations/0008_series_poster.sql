-- 0008_series_poster.sql  (ratified proposal 0009c)
-- Promotional poster art for a series. poster_url points at the chosen generated image; poster_provenance
-- carries the C2PA / synthetic marker for the Article 50 posture. Additive and nullable.
alter table series add column if not exists poster_url        text;
alter table series add column if not exists poster_provenance jsonb;
