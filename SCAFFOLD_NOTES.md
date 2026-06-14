# Scaffold notes

## Fixed in the committed scaffold
- turbo.json uses `tasks` (Turbo 2.x renamed `pipeline` to `tasks`); `$schema` is turbo.build.
- The contracts package is `@axessplayer/contracts`, matching the per-package CLAUDE.md import references.

## Two items for the W0 run (need real execution)
1. Lockfile. CI runs `pnpm install --frozen-lockfile`, but there is no committed `pnpm-lock.yaml` yet. W0 runs `pnpm install` once (non-frozen) to generate the lockfile, commits it, then frozen installs work in CI.
2. First migration placement. `supabase/migrations/0002_spend_rpc.sql` references tables defined in `contracts/schema/0001_init.sql`. Make `supabase/migrations/0001_init.sql` the canonical first migration: copy `contracts/schema/0001_init.sql` into `supabase/migrations/0001_init.sql` as part of the build, so `supabase db reset` applies 0001 then 0002. Keep one canonical source to avoid drift.

No em dashes.
