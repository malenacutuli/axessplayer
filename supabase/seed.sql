-- Walking-skeleton seed. One series, one episode, a cold open, a branch at beat 2 (calm vs tense),
-- a shared ending, and a premium alternate ending. Apply after 0001_init.sql and 0002_spend_rpc.sql.
-- Fixture data only, not production content. Placeholder playback_urls. No em dashes.

INSERT INTO series (id, title, genre, base_language) VALUES
  ('11111111-1111-1111-1111-111111111111','The Last Signal','thriller','en');

INSERT INTO episodes (id, series_id, episode_number, title, is_free, coin_cost) VALUES
  ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',1,'Pilot',true,0);

-- beats: cold open, branch point, two branch cuts, shared ending
INSERT INTO beats (id, series_id, episode_id, beat_index, role, is_branch_point) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',0,'cold_open',false),
  ('bbbbbbbb-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',1,'spine',true),
  ('bbbbbbbb-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',2,'variant',false),
  ('bbbbbbbb-0000-0000-0000-00000000000b','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',2,'variant',false),
  ('bbbbbbbb-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',3,'ending',false);

-- one variant per beat; b4 also carries a premium alternate ending (costs coins)
INSERT INTO beat_variants (id, beat_id, language, intensity, tier, is_premium, coin_cost, playback_url) VALUES
  ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','en',3,'A_filmed',false,0,'https://cdn.example/skel/coldopen.m3u8'),
  ('cccccccc-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002','en',3,'A_filmed',false,0,'https://cdn.example/skel/branchpoint.m3u8'),
  ('cccccccc-0000-0000-0000-00000000000a','bbbbbbbb-0000-0000-0000-00000000000a','en',2,'A_filmed',false,0,'https://cdn.example/skel/calm.m3u8'),
  ('cccccccc-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-00000000000b','en',5,'A_filmed',false,0,'https://cdn.example/skel/tense.m3u8'),
  ('cccccccc-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-000000000004','en',3,'A_filmed',false,0,'https://cdn.example/skel/ending.m3u8'),
  ('cccccccc-0000-0000-0000-000000000005','bbbbbbbb-0000-0000-0000-000000000004','en',4,'A_filmed',true,5,'https://cdn.example/skel/ending_premium.m3u8');

-- edges: cold open -> branch point -> {calm, tense} -> ending
INSERT INTO beat_edges (from_beat_id, to_beat_id, condition) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','{}'),
  ('bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000a','{"branch":"calm"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','{"branch":"tense"}'),
  ('bbbbbbbb-0000-0000-0000-00000000000a','bbbbbbbb-0000-0000-0000-000000000004','{}'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000004','{}');

-- two test users, wallets (10 coins each), seeded viewer_state
INSERT INTO users (id, email, preferred_language, adaptive_opt_in) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','high-intensity@example.test','en',true),
  ('aaaaaaaa-0000-0000-0000-000000000002','low-intensity@example.test','en',true);
INSERT INTO coin_wallet (user_id, balance, bonus_balance) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001',10,0),
  ('aaaaaaaa-0000-0000-0000-000000000002',10,0);
INSERT INTO viewer_state (user_id, series_id, preference_vector, cohort_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','{"intensity":5}','seed'),
  ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','{"intensity":2}','seed');

-- Walking-skeleton checks (run by W12):
--  control arm: chooseBranch returns the calm cut (director's cut) regardless of intensity.
--  treatment, intensity 5: returns the tense cut.
--  unlock the premium ending: spend_coins(user, 'beat_variant', 'cccccccc-...0005', txn) deducts 5 once; repeat with same txn is a no-op.
