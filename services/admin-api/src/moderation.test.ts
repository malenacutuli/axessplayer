// Moderation aggregate tests: the queue probes the social tables and returns empty + unwired when absent
// (never fabricated items), the policy read model has the documented age-gate/rate-limit/community rules,
// and the scan provider surfaces pending_provider (never a clean verdict). No live Postgres. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { socialTablesProbeSql } from "./queries.js";
import { buildModerationQueue, buildModerationPolicy } from "./moderation.js";
import type { QueryPort } from "./aggregate.js";

function fakePg(answers: Array<{ match: RegExp; rows: unknown[] }>): QueryPort {
  return {
    async query(text: string) {
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  } as unknown as QueryPort;
}

test("social-tables probe reads information_schema for the UGC tables", () => {
  const t = socialTablesProbeSql().text;
  assert.match(t, /from information_schema\.tables/);
  assert.match(t, /'posts'/);
  assert.match(t, /'comments'/);
  assert.match(t, /'reports'/);
});

test("moderation queue is empty + unwired when no social tables exist (never fabricated items)", async () => {
  const db = fakePg([{ match: /information_schema\.tables/, rows: [] }]);
  const v = await buildModerationQueue(db);
  assert.deepEqual(v.items, []);
  assert.equal(v.source, "unwired");
  assert.ok(v.note.length > 0);
  // The scan provider is surfaced as unwired (pending_provider semantics), never a silent clean queue.
  assert.equal(v.scanProvider, "unwired");
});

test("moderation queue with a social table present is derived-source empty, not fabricated", async () => {
  const db = fakePg([{ match: /information_schema\.tables/, rows: [{ table_name: "posts" }] }]);
  const v = await buildModerationQueue(db);
  assert.deepEqual(v.items, []);
  assert.equal(v.source, "hosted");
});

test("moderation policy is the documented default with age-gate, rate limits, community rules", () => {
  const p = buildModerationPolicy();
  assert.equal(p.source, "default");
  assert.equal(typeof p.ageGate.minViewAge, "number");
  assert.equal(typeof p.ageGate.minPostAge, "number");
  assert.ok(p.rateLimits.postsPerHour > 0);
  assert.ok(p.communityRules.length >= 3);
  // CSAM is an explicit community rule.
  assert.ok(p.communityRules.some((r) => r.id === "no_csam"));
});

test("moderation policy reports the unwired scan provider as pending_provider, never a clean enforcement", () => {
  const p = buildModerationPolicy();
  assert.equal(p.scanProvider.name, "unwired");
  assert.equal(p.scanProvider.status, "pending_provider");
  assert.notEqual(p.scanProvider.status, "clean");
});
