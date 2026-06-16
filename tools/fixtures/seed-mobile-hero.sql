-- Prompt 01 hero-series content fixture for the hosted mobile schema (project faeyekynudyzeotbjfsj).
-- Idempotent. Writes ONLY to the isolated mobile schema; public untouched. Apply with the Supabase
-- MCP execute_sql or psql against the hosted DB. Media built by tools/fixtures/build-hero-fixture.sh
-- and served by the local media-server at /media/hero/<name>-<pace>.mp4. No em dashes.
--
-- One hero series, one episode, 6 high-leverage beats, 2 pace variants per beat (slow = designated
-- Control / showrunner cut, fast = treatment candidate). The Gate A experiment varies exactly the
-- pace axis. tier='showrunner' marks the Control variant per beat; tier='candidate' the alternate.

insert into mobile.series (id, title, genre, base_language, available_languages, published_at)
values ('2a000000-0000-0000-0000-000000000001','The Other Key (Hero Test)','thriller','en','{en}', now())
on conflict (id) do update set title=excluded.title, published_at=excluded.published_at;

insert into mobile.episodes (id, series_id, episode_number, title, is_free, coin_cost)
values ('2a000000-0000-0000-0000-0000000000e1','2a000000-0000-0000-0000-000000000001',1,'Episode 1', true, 0)
on conflict (id) do update set title=excluded.title;

insert into mobile.beats (id, series_id, episode_id, beat_index, role, is_branch_point) values
 ('2a000000-0000-0000-0000-0000000000b1','2a000000-0000-0000-0000-000000000001','2a000000-0000-0000-0000-0000000000e1',0,'hook',false),
 ('2a000000-0000-0000-0000-0000000000b2','2a000000-0000-0000-0000-000000000001','2a000000-0000-0000-0000-0000000000e1',1,'cliffhanger',false),
 ('2a000000-0000-0000-0000-0000000000b3','2a000000-0000-0000-0000-000000000001','2a000000-0000-0000-0000-0000000000e1',2,'cliffhanger',false),
 ('2a000000-0000-0000-0000-0000000000b4','2a000000-0000-0000-0000-000000000001','2a000000-0000-0000-0000-0000000000e1',3,'branch_point',true),
 ('2a000000-0000-0000-0000-0000000000b5','2a000000-0000-0000-0000-000000000001','2a000000-0000-0000-0000-0000000000e1',4,'pre_paywall',false),
 ('2a000000-0000-0000-0000-0000000000b6','2a000000-0000-0000-0000-000000000001','2a000000-0000-0000-0000-0000000000e1',5,'ending',false)
on conflict (id) do update set role=excluded.role, is_branch_point=excluded.is_branch_point;

insert into mobile.beat_variants (id, beat_id, language, intensity, pov, tier, is_premium, coin_cost, playback_url, qa_status) values
 ('2a000000-0000-0000-0000-0000000000a1','2a000000-0000-0000-0000-0000000000b1','en',2,'pace:slow','showrunner',false,0,'http://127.0.0.1:8095/media/hero/hook-slow.mp4','passed'),
 ('2a000000-0000-0000-0000-0000000000f1','2a000000-0000-0000-0000-0000000000b1','en',5,'pace:fast','candidate',false,0,'http://127.0.0.1:8095/media/hero/hook-fast.mp4','passed'),
 ('2a000000-0000-0000-0000-0000000000a2','2a000000-0000-0000-0000-0000000000b2','en',2,'pace:slow','showrunner',false,0,'http://127.0.0.1:8095/media/hero/cliff1-slow.mp4','passed'),
 ('2a000000-0000-0000-0000-0000000000f2','2a000000-0000-0000-0000-0000000000b2','en',5,'pace:fast','candidate',false,0,'http://127.0.0.1:8095/media/hero/cliff1-fast.mp4','passed'),
 ('2a000000-0000-0000-0000-0000000000a3','2a000000-0000-0000-0000-0000000000b3','en',2,'pace:slow','showrunner',false,0,'http://127.0.0.1:8095/media/hero/cliff2-slow.mp4','passed'),
 ('2a000000-0000-0000-0000-0000000000f3','2a000000-0000-0000-0000-0000000000b3','en',5,'pace:fast','candidate',false,0,'http://127.0.0.1:8095/media/hero/cliff2-fast.mp4','passed'),
 ('2a000000-0000-0000-0000-0000000000a4','2a000000-0000-0000-0000-0000000000b4','en',2,'pace:slow','showrunner',false,0,'http://127.0.0.1:8095/media/hero/branch-slow.mp4','passed'),
 ('2a000000-0000-0000-0000-0000000000f4','2a000000-0000-0000-0000-0000000000b4','en',5,'pace:fast','candidate',false,0,'http://127.0.0.1:8095/media/hero/branch-fast.mp4','passed'),
 ('2a000000-0000-0000-0000-0000000000a5','2a000000-0000-0000-0000-0000000000b5','en',2,'pace:slow','showrunner',false,0,'http://127.0.0.1:8095/media/hero/prepay-slow.mp4','passed'),
 ('2a000000-0000-0000-0000-0000000000f5','2a000000-0000-0000-0000-0000000000b5','en',5,'pace:fast','candidate',false,0,'http://127.0.0.1:8095/media/hero/prepay-fast.mp4','passed'),
 ('2a000000-0000-0000-0000-0000000000a6','2a000000-0000-0000-0000-0000000000b6','en',2,'pace:slow','showrunner',false,0,'http://127.0.0.1:8095/media/hero/ending-slow.mp4','passed'),
 ('2a000000-0000-0000-0000-0000000000f6','2a000000-0000-0000-0000-0000000000b6','en',5,'pace:fast','candidate',false,0,'http://127.0.0.1:8095/media/hero/ending-fast.mp4','passed')
on conflict (id) do update set playback_url=excluded.playback_url, tier=excluded.tier, pov=excluded.pov, qa_status=excluded.qa_status;

insert into mobile.beat_edges (from_beat_id, to_beat_id) values
 ('2a000000-0000-0000-0000-0000000000b1','2a000000-0000-0000-0000-0000000000b2'),
 ('2a000000-0000-0000-0000-0000000000b2','2a000000-0000-0000-0000-0000000000b3'),
 ('2a000000-0000-0000-0000-0000000000b3','2a000000-0000-0000-0000-0000000000b4'),
 ('2a000000-0000-0000-0000-0000000000b4','2a000000-0000-0000-0000-0000000000b5'),
 ('2a000000-0000-0000-0000-0000000000b5','2a000000-0000-0000-0000-0000000000b6')
on conflict (from_beat_id, to_beat_id) do nothing;
