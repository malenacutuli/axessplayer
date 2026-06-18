-- 14_social.sql  (SLICE SOCIAL: viewer prompt 20-V8 social/community, services/social)
--
-- ADDITIVE social/community tables on the mobile overlay schema, backing prompt 20-V8: verified character
-- feeds (a character a viewer can follow, with verified posts), threaded comments on a show, likes,
-- moderation reports, and the safety primitives block / mute. This is the HIGHEST-RISK viewer surface;
-- the schema is shaped so the service can enforce its hard gates (age-gate, fail-closed UGC moderation,
-- rate limits, report queue, block/mute) without ever auto-publishing unscanned UGC.
--
-- MODERATION FAIL-CLOSED (hard gate): every user-generated write (post, comment) lands with
-- moderation_status = 'pending' and is INVISIBLE to readers until a scan clears it. With NO real scan
-- provider wired, the pipeline returns 'pending_provider' and the row STAYS unpublished forever (the
-- opposite of fail-open). A row only becomes visible when moderation_status = 'approved'. The default is
-- 'pending' so a forgotten write path cannot leak unscanned content. There is NO auto-clean default.
--
-- AGE-GATE (hard gate): mature character communities (characters.mature = true on the existing catalog,
-- or the community's own maturity flag) are unreachable by minors. This service reads the viewer's
-- age-band from the identity/profile plane (interface only); this schema only stores the community
-- maturity flag it needs to gate against. No romantic/parasocial overlap is modelled here.
--
-- UNWIRED until applied: until this script is applied, services/social runs against its injected
-- in-memory SocialStore (tests). Nothing here is read by the live services. QUEUED FOR APPLY, NOT executed.
--
-- HARD RULES honoured by this file:
--   * ADDITIVE ONLY, "create ... if not exists" / "add column if not exists", safely re-runnable.
--   * Never edits a frozen migration under supabase/migrations/ or anything under contracts/.
--   * NEVER executed against the hosted DB by any tool; written for a human-reviewed apply.
--   * RLS ships a service_role bypass so the service (service_role) keeps full access once RLS is on.
--   * Viewer-readable policies expose ONLY approved, non-deleted rows (fail-closed visibility).
--
-- No em dashes anywhere by project rule.

begin;

create schema if not exists mobile;

-- A viewer following a verified character's feed. (user_id, character_id) is the natural key; following is
-- idempotent. character_id references the existing catalog character identity (owned elsewhere); this table
-- only records the follow edge.
create table if not exists mobile.character_follows (
  user_id      uuid not null,
  character_id uuid not null,
  created_at   timestamptz not null default now(),
  primary key (user_id, character_id)
);

create index if not exists character_follows_user_idx
  on mobile.character_follows (user_id, created_at desc);
create index if not exists character_follows_character_idx
  on mobile.character_follows (character_id, created_at desc);

-- Verified character posts (the character feed). author_user_id is the verified operator who posts AS the
-- character (the verification check lives in the service / operator verifier, not here). mature gates the
-- post against minors. moderation_status defaults to 'pending': even a verified character post is scanned
-- before it is visible. body is the post text; media_url an optional attachment reference.
create table if not exists mobile.posts (
  id                uuid primary key default gen_random_uuid(),
  character_id      uuid not null,
  author_user_id    uuid not null,
  body              text not null,
  media_url         text,
  mature            boolean not null default false,
  moderation_status text not null default 'pending',
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists posts_feed_idx
  on mobile.posts (character_id, created_at desc);
-- The moderation queue read path: pending items oldest-first.
create index if not exists posts_moderation_idx
  on mobile.posts (moderation_status, created_at asc);

-- Threaded comments on a show (series). parent_comment_id null = a top-level comment; a non-null parent is
-- a reply (one level of threading in this cut). author_user_id is the commenter (the session subject).
-- moderation_status defaults to 'pending' (fail-closed). like_count is a denormalized counter the service
-- maintains; the canonical likes live in mobile.likes.
create table if not exists mobile.comments (
  id                uuid primary key default gen_random_uuid(),
  show_id           uuid not null,
  parent_comment_id uuid references mobile.comments (id),
  author_user_id    uuid not null,
  body              text not null,
  moderation_status text not null default 'pending',
  like_count        integer not null default 0,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists comments_show_idx
  on mobile.comments (show_id, created_at desc);
create index if not exists comments_thread_idx
  on mobile.comments (parent_comment_id, created_at asc);
create index if not exists comments_moderation_idx
  on mobile.comments (moderation_status, created_at asc);

-- Likes on a post or a comment. subject_kind is 'post' or 'comment'; (user_id, subject_kind, subject_id)
-- is the natural key so a like is idempotent and a viewer cannot double-count.
create table if not exists mobile.likes (
  user_id      uuid not null,
  subject_kind text not null,
  subject_id   uuid not null,
  created_at   timestamptz not null default now(),
  primary key (user_id, subject_kind, subject_id)
);

create index if not exists likes_subject_idx
  on mobile.likes (subject_kind, subject_id);

-- Moderation reports filed by viewers. subject_kind is 'post' or 'comment'; reason is a free-text or coded
-- reason. status defaults to 'open' so the report lands in the moderation queue for a human reviewer. A
-- report NEVER auto-removes content (human-in-the-loop), it only enqueues.
create table if not exists mobile.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null,
  subject_kind text not null,
  subject_id   uuid not null,
  reason       text not null,
  status       text not null default 'open',
  created_at   timestamptz not null default now()
);

create index if not exists reports_status_idx
  on mobile.reports (status, created_at asc);
create index if not exists reports_subject_idx
  on mobile.reports (subject_kind, subject_id);

-- Blocks: blocker_id will not see content from blocked_id and blocked_id cannot interact with blocker_id.
create table if not exists mobile.blocks (
  blocker_id uuid not null,
  blocked_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

-- Mutes: muter_id hides muted_id's content from their own view (softer than a block; no interaction bar).
create table if not exists mobile.mutes (
  muter_id   uuid not null,
  muted_id   uuid not null,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id)
);

-- RLS. Ship a service_role bypass so the service keeps full access once RLS is on. Viewer-readable
-- policies (where present) expose ONLY approved, non-deleted rows so unscanned/pending UGC is never
-- readable through the anon/authenticated path (fail-closed visibility, matching the service).
alter table mobile.character_follows enable row level security;
alter table mobile.posts enable row level security;
alter table mobile.comments enable row level security;
alter table mobile.likes enable row level security;
alter table mobile.reports enable row level security;
alter table mobile.blocks enable row level security;
alter table mobile.mutes enable row level security;

do $$
declare
  t text;
  tables text[] := array[
    'character_follows', 'posts', 'comments', 'likes', 'reports', 'blocks', 'mutes'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'mobile' and tablename = t
        and policyname = t || '_service_role_all'
    ) then
      execute format(
        'create policy %I on mobile.%I as permissive for all to service_role using (true) with check (true)',
        t || '_service_role_all', t
      );
    end if;
  end loop;

  -- Viewer read of approved, non-deleted posts only (fail-closed visibility).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'posts' and policyname = 'posts_read_approved'
  ) then
    execute
      'create policy posts_read_approved on mobile.posts as permissive for select to authenticated '
      || 'using (moderation_status = ''approved'' and deleted_at is null)';
  end if;

  -- Viewer read of approved, non-deleted comments only (fail-closed visibility).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'mobile' and tablename = 'comments' and policyname = 'comments_read_approved'
  ) then
    execute
      'create policy comments_read_approved on mobile.comments as permissive for select to authenticated '
      || 'using (moderation_status = ''approved'' and deleted_at is null)';
  end if;
end
$$;

commit;
