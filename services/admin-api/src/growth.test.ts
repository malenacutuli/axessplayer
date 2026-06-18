// Growth tests: referral-loop health aggregation, the creative-bandit unwired probe, the CAC/LTV/payback
// band-estimate unwired shape. No live Postgres. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { referralHealthSql, creativeExperimentTableProbeSql } from "./queries.js";
import {
  deriveReferralHealth,
  buildReferralHealth,
  buildCreativeBandit,
  buildAcquisition,
  buildGrowth,
} from "./growth.js";
import type { QueryPort } from "./aggregate.js";

function fakePg(answers: Array<{ match: RegExp; rows: unknown[] }>): QueryPort {
  return {
    async query(text: string) {
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  } as unknown as QueryPort;
}

test("referral health SQL counts by status and the neutral reward_granted flag over mobile.referrals", () => {
  const t = referralHealthSql().text;
  assert.match(t, /from referrals/);
  assert.match(t, /filter \(where status = 'invited'\)/);
  assert.match(t, /filter \(where status = 'joined'\)/);
  assert.match(t, /filter \(where status = 'first_watch'\)/);
  assert.match(t, /filter \(where reward_granted\)/);
});

test("deriveReferralHealth folds status counts into funnel rates without dividing by zero", () => {
  const h = deriveReferralHealth({ invited: 100, joined: 40, first_watch: 10, reward_granted: 8, total: 150 });
  assert.equal(h.invited, 100);
  assert.equal(h.joined, 40);
  assert.equal(h.firstWatch, 10);
  assert.equal(h.rewardGranted, 8);
  // reached = 100 + 40 + 10 = 150; atLeastJoined = 50; joinRate = 50/150.
  assert.ok(Math.abs(h.joinRate - 50 / 150) < 1e-9);
  // firstWatchRate = 10/50.
  assert.ok(Math.abs(h.firstWatchRate - 10 / 50) < 1e-9);

  // Empty loop: zero everywhere, never NaN.
  const empty = deriveReferralHealth(undefined);
  assert.equal(empty.joinRate, 0);
  assert.equal(empty.firstWatchRate, 0);
});

test("buildReferralHealth reads the single aggregate row", async () => {
  const db = fakePg([{ match: /from referrals/, rows: [{ invited: 5, joined: 2, first_watch: 1, reward_granted: 1, total: 8 }] }]);
  const h = await buildReferralHealth(db);
  assert.equal(h.total, 8);
  assert.equal(h.firstWatch, 1);
});

test("creative bandit returns empty + unwired when no creative table exists (never fabricated arms)", async () => {
  assert.match(creativeExperimentTableProbeSql().text, /from information_schema\.tables/);
  const db = fakePg([{ match: /information_schema\.tables/, rows: [] }]);
  const v = await buildCreativeBandit(db);
  assert.deepEqual(v.arms, []);
  assert.equal(v.source, "unwired");
  assert.ok(v.note.length > 0);
});

test("acquisition CAC/LTV/payback is unwired and issues NO query (no spend source to read)", async () => {
  const throwing = { async query() { throw new Error("acquisition must not query without a spend source"); } } as unknown as QueryPort;
  const v = await buildAcquisition(throwing);
  assert.deepEqual(v.channels, []);
  assert.equal(v.source, "unwired");
});

test("buildGrowth composes all three blocks", async () => {
  const db = fakePg([
    { match: /information_schema\.tables/, rows: [] },
    { match: /from referrals/, rows: [{ invited: 3, joined: 1, first_watch: 0, reward_granted: 0, total: 4 }] },
  ]);
  const g = await buildGrowth(db);
  assert.equal(g.creativeBandit.source, "unwired");
  assert.equal(g.acquisition.source, "unwired");
  assert.equal(g.referrals.invited, 3);
});
