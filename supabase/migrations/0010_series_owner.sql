-- 0010: series ownership (creator platform). Additive.
-- Every content write is now checked against the series owner (services/content/src/ownership.ts). The owner
-- is the creator's profile id (users.id), set when the series is created. Series created before this
-- migration have no owner and can only be changed after an operator assigns one:
--   update series set owner_id = '<profile users.id>' where id = '<series id>';
alter table series add column if not exists owner_id uuid references users(id) on delete set null;
create index if not exists series_owner_idx on series(owner_id);
