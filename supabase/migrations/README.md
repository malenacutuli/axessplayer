# migrations

Place the committed contracts/schema/0001_init.sql here (or symlink it) as the first migration:
  supabase/migrations/0001_init.sql
Apply with: supabase db reset (local) or supabase migration up.
The migration includes the RLS enable block. Per-service RLS policies land in later, per-service migrations.
