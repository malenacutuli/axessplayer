// Seed-graph identities and the extra control viewer the acceptance flow needs. The walking-skeleton
// seed (supabase/seed.sql) carries the series, episode, beats, variants, edges, and two TREATMENT-bucket
// viewers (both seed user ids hash into the treatment arm). To exercise BOTH arms the harness seeds one
// extra viewer whose id hashes into the CONTROL arm. This is test-fixture setup against the harness's own
// ephemeral database, not a change to seed.sql. No em dashes.

import type pg from "pg";
import { assignControl } from "../../../services/decision/src/policy.js";

export const SERIES = "11111111-1111-1111-1111-111111111111";

// Beats.
export const BEAT_COLD_OPEN = "bbbbbbbb-0000-0000-0000-000000000001";
export const BEAT_BRANCH = "bbbbbbbb-0000-0000-0000-000000000002"; // is_branch_point = true
export const BEAT_ENDING = "bbbbbbbb-0000-0000-0000-000000000004";

// Variants.
export const VAR_COLD_OPEN = "cccccccc-0000-0000-0000-000000000001";
export const VAR_BRANCHPOINT = "cccccccc-0000-0000-0000-000000000002";
export const VAR_CALM = "cccccccc-0000-0000-0000-00000000000a"; // director's cut, intensity 2
export const VAR_TENSE = "cccccccc-0000-0000-0000-00000000000b"; // tense cut, intensity 5
export const VAR_ENDING = "cccccccc-0000-0000-0000-000000000004";
export const VAR_ENDING_PREMIUM = "cccccccc-0000-0000-0000-000000000005"; // is_premium, coin_cost 5

// Seeded viewers (both land in the TREATMENT bucket per assignControl).
export const USER_TREATMENT = "aaaaaaaa-0000-0000-0000-000000000001"; // viewer_state intensity 5
export const USER_TREATMENT_LOW = "aaaaaaaa-0000-0000-0000-000000000002"; // viewer_state intensity 2

// An extra viewer whose id hashes into the CONTROL arm. Verified at module load so a future change to the
// holdout percentage cannot silently put this id in the wrong arm.
export const USER_CONTROL = "aaaaaaaa-0000-0000-0000-00000000006d";

// Static guards: prove the arms are what the flow assumes before any DB work.
if (!assignControl(USER_CONTROL)) {
  throw new Error(`USER_CONTROL ${USER_CONTROL} is not in the control bucket`);
}
if (assignControl(USER_TREATMENT)) {
  throw new Error(`USER_TREATMENT ${USER_TREATMENT} is not in the treatment bucket`);
}

// Seed the extra control viewer plus its wallet and viewer_state into the harness database.
export async function seedControlViewer(pool: pg.Pool): Promise<void> {
  await pool.query(
    `insert into public.users (id, email, preferred_language, adaptive_opt_in)
     values ($1, 'control@example.test', 'en', true)
     on conflict (id) do nothing`,
    [USER_CONTROL]
  );
  await pool.query(
    `insert into public.coin_wallet (user_id, balance, bonus_balance)
     values ($1, 10, 0) on conflict (user_id) do nothing`,
    [USER_CONTROL]
  );
  await pool.query(
    `insert into public.viewer_state (user_id, series_id, preference_vector, cohort_id)
     values ($1, $2, '{"intensity":2}', 'seed')
     on conflict (user_id, series_id) do nothing`,
    [USER_CONTROL, SERIES]
  );
}
