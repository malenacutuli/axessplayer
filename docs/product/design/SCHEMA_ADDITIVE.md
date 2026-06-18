# Schema additive overlay (slice 20)

Status: ADDITIVE ONLY. Every object below is added with `create ... if not exists`,
`alter ... add column if not exists`, guarded `add constraint`, or `insert ... on conflict
do nothing`, so each script is safely re-runnable. Nothing here edits a frozen migration under
`supabase/migrations/` or anything under `contracts/`. The scripts are NOT executed by this slice;
the main loop reviews them and applies them via the Supabase MCP.

All objects live in the `mobile` overlay schema, the isolated namespace the live services read
through with `DB_OPTIONS=-c search_path=mobile,public`. The frozen `public.series` /
`public.users` tables from `0001_init.sql` are untouched.

RLS posture: every table that carries per-viewer data enables Row Level Security ADDITIVELY. To
avoid locking out the existing service-role access (the live services connect as `service_role`),
each such table ships a permissive `service_role` bypass policy (`using (true) with check (true)`)
alongside the owner-scoped viewer policies. Viewer ownership is matched on
`auth.uid() = mobile.users.auth_id`. Catalog tables that carry no personal data
(`channels`, `series_channels`) do not enable per-viewer RLS in this slice.

## scripts/sql/02_auth_profiles.sql (20-V0)

Table `mobile.users` (additive columns on the overlay user row):

| column | type | notes |
| --- | --- | --- |
| `auth_id` | `uuid` | links to the auth identity; partial-unique when not null |
| `username` | `citext` | case-insensitive, partial-unique when not null |
| `avatar_url` | `text` | |
| `tier` | `text` | not null, default `'free'` |
| `created_at` | `timestamptz` | not null, default `now()` |

Also creates the `citext` extension if absent and a minimal `mobile.users (id uuid pk)` stub so a
cold apply does not fail. Unique indexes: `mobile_users_auth_id_key`, `mobile_users_username_key`
(both partial, `where ... is not null`).

RLS (enabled additively):
- `users_service_role_all` (all, service_role): bypass so existing service-role access is preserved.
- `users_owner_select` (select, authenticated): `auth.uid() = auth_id`.
- `users_owner_update` (update, authenticated): `auth.uid() = auth_id` for both `using` and `with check`.
- `users_owner_insert` (insert, authenticated): `with check (auth.uid() = auth_id)`.

## scripts/sql/03_channels.sql (20-V2)

Tables:
- `mobile.channels` (`id uuid pk default gen_random_uuid()`, `slug text unique`, `name text`,
  `description text`, `genres text[]`, `hero_url text`).
- `mobile.series_channels` (`series_id uuid`, `channel_id uuid`, pk on the pair). Join table, no FK
  to the frozen series table so the overlay stays self-contained; integrity at the service layer.
- `mobile.channel_follows` (`user_id uuid`, `channel_id uuid`, `notify boolean default true`,
  `created_at timestamptz default now()`, pk `(user_id, channel_id)`).

Seed: 9 launch channels inserted with `on conflict (slug) do nothing`:
Telenovela, Crime, Thriller, Reality, Cooking, Podcasts, Education, Children, Drama.

RLS (on `channel_follows` only):
- `channel_follows_service_role_all` (all, service_role): bypass.
- `channel_follows_owner_select` (select, authenticated): owner via `mobile.users.auth_id`.
- `channel_follows_owner_write` (all, authenticated): owner via `mobile.users.auth_id`, `using` + `with check`.

`channels` and `series_channels` carry no personal data and are left without per-viewer RLS here.

## scripts/sql/04_library.sql (20-V4)

Tables:
- `mobile.saved` (`user_id uuid`, `series_id uuid`, `created_at timestamptz`, pk `(user_id, series_id)`).
- `mobile.favorites` (`user_id uuid`, `target_type text check in ('show','character')`,
  `target_id uuid`, `created_at timestamptz`, pk `(user_id, target_type, target_id)`).
- `mobile.downloads` (`user_id uuid`, `series_id uuid`, `episode_ids uuid[] default '{}'`,
  `bytes bigint default 0`, `status text default 'queued'`, `created_at timestamptz`,
  pk `(user_id, series_id)`).

RLS (each table, generated in a loop):
- `<table>_service_role_all` (all, service_role): bypass.
- `<table>_owner_all` (all, authenticated): owner via `auth.uid() = mobile.users.auth_id` matched on
  the row's `user_id`, in both `using` and `with check`. Users see and write only their own rows.

## scripts/sql/05_referrals.sql (20-V7)

Table `mobile.referrals`:

| column | type | notes |
| --- | --- | --- |
| `id` | `uuid` | pk, default `gen_random_uuid()` |
| `code` | `text` | not null, `length(code) > 0` |
| `inviter_id` | `uuid` | not null |
| `invitee_id` | `uuid` | nullable until the invite is accepted |
| `status` | `text` | check `in ('invited','joined','first_watch')`, default `'invited'` |
| `reward_granted` | `boolean` | not null, default `false`; neutral bookkeeping, not an objective |
| `created_at` | `timestamptz` | not null, default `now()` |

Constraints / indexes:
- `mobile_referrals_invitee_key`: partial unique on `invitee_id where invitee_id is not null` (an
  invitee is claimed by at most one referral; multiple open invites allowed).
- `referrals_no_self_referral` (guarded add): `check (invitee_id is null or inviter_id <> invitee_id)`.
  GUARD preventing self-referral; an open invite (`invitee_id null`) passes.
- `referrals_code_not_blank` (guarded add): `check (length(code) > 0)`.

RLS:
- `referrals_service_role_all` (all, service_role): bypass for server-side status/reward writes.
- `referrals_participant_select` (select, authenticated): viewer is inviter OR invitee via
  `mobile.users.auth_id`.
- `referrals_inviter_insert` (insert, authenticated): may insert only as the inviter; the table
  check constraint backstops the self-referral guard for every role.

GATE: `reward_granted` is display-only bookkeeping. No revenue or extraction objective is encoded;
reward weights remain DRAFT and neutral.

## scripts/sql/06_format.sql

Column on `mobile.series`:

| column | type | notes |
| --- | --- | --- |
| `format` | `text` | not null, default `'Series'`, check `in ('Series','Podcast','Film')` |

The frozen `public.series` is left untouched; the additive column lands on the `mobile.series`
overlay the app reads. A minimal `mobile.series (id uuid pk)` stub is created if the overlay has not
been materialized, so a cold apply of the `add column` never fails. Constraint `series_format_check`
is added only when absent.
