// Brand rail aggregate tests (sections 7-8). The brand/campaign/placement/performance reads PROBE
// information_schema for their mobile rail table: ABSENT -> empty + source:"unwired" (rows are never
// fabricated); PRESENT -> a real SELECT returns hosted rows. The CONTENT/AD FIREWALL is asserted on the SQL
// text: none of the brand rail builders may reference a content-ranking / decision relation. No live
// Postgres. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  brandTableProbeSql,
  brandAccountsSql,
  brandCampaignsSql,
  placementSlotsSql,
  brandPerformanceSql,
} from "./queries.js";
import {
  buildBrands,
  buildCampaigns,
  buildPlacements,
  buildBrandPerformance,
} from "./aggregate.js";
import type { QueryPort } from "./aggregate.js";

function fakePg(answers: Array<{ match: RegExp; rows: unknown[] }>): QueryPort {
  return {
    async query(text: string) {
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  } as unknown as QueryPort;
}

// A db that returns rows only when the catalog probe is asked; the read SELECTs answer with rows too. The
// probe text and the read text differ, so the test can prove the present branch issues a second SELECT.
const tablePresent = (readMatch: RegExp, readRows: unknown[]): QueryPort =>
  fakePg([
    { match: /information_schema\.tables/, rows: [{ table_name: "x" }] },
    { match: readMatch, rows: readRows },
  ]);

// ---- ABSENT branch: empty + unwired, never fabricated -----------------------------------------------

test("brands/campaigns/placements/performance are empty + unwired when the rail table is absent", async () => {
  const db = fakePg([{ match: /information_schema\.tables/, rows: [] }]);
  for (const view of [
    await buildBrands(db),
    await buildCampaigns(db),
    await buildPlacements(db),
    await buildBrandPerformance(db),
  ]) {
    assert.deepEqual(view.items, []);
    assert.equal(view.source, "unwired");
    assert.match(view.note, /not applied/);
  }
});

test("the absent branch issues ONLY the information_schema probe (no read of a missing relation)", async () => {
  let sawRead = false;
  const db = {
    async query(text: string) {
      if (!/information_schema\.tables/.test(text)) sawRead = true;
      return { rows: [] };
    },
  } as unknown as QueryPort;
  await buildBrands(db);
  await buildCampaigns(db);
  await buildPlacements(db);
  await buildBrandPerformance(db);
  assert.equal(sawRead, false, "no SELECT runs against a brand rail table when it is absent");
});

// ---- PRESENT branch: real rows, source hosted -------------------------------------------------------

test("buildBrands reads real rows when brand_accounts exists", async () => {
  const db = tablePresent(/from brand_accounts/, [{ id: "b1", name: "Acme", status: "active" }]);
  const v = await buildBrands(db);
  assert.equal(v.source, "hosted");
  assert.deepEqual(v.items, [{ id: "b1", name: "Acme", status: "active" }]);
});

test("buildCampaigns reads real rows and maps brand_id/starts_at/ends_at", async () => {
  const db = tablePresent(/from brand_campaigns/, [
    { id: "c1", brand_id: "b1", name: "Spring", status: "live", starts_at: "2026-01-01T00:00:00Z", ends_at: null },
  ]);
  const v = await buildCampaigns(db);
  assert.equal(v.source, "hosted");
  assert.equal(v.items[0].brandId, "b1");
  assert.equal(v.items[0].startsAt, "2026-01-01T00:00:00Z");
  assert.equal(v.items[0].endsAt, null);
});

test("buildPlacements reads real rows and maps campaign_id/slot", async () => {
  const db = tablePresent(/from placement_slots/, [{ id: "p1", campaign_id: "c1", slot: "cafe-table", status: "filled" }]);
  const v = await buildPlacements(db);
  assert.equal(v.source, "hosted");
  assert.equal(v.items[0].campaignId, "c1");
  assert.equal(v.items[0].slot, "cafe-table");
});

test("buildBrandPerformance reads the SEPARATE objective metrics when the log exists", async () => {
  const db = tablePresent(/from brand_performance/, [
    { campaign_id: "c1", impressions: 100, completions: 80, brand_recall: 12 },
  ]);
  const v = await buildBrandPerformance(db);
  assert.equal(v.source, "hosted");
  assert.equal(v.items[0].campaignId, "c1");
  assert.equal(v.items[0].impressions, 100);
  assert.equal(v.items[0].completions, 80);
  assert.equal(v.items[0].brandRecall, 12);
  // The note states this is a SEPARATE surface that never feeds the content reward function.
  assert.match(v.note, /never feeds the content reward function/);
});

// ---- CONTENT/AD FIREWALL: no content-ranking relation in any brand rail SQL -------------------------

test("FIREWALL: brand rail SQL never references a content-ranking / decision relation", () => {
  const forbidden = [
    /decision_log/,
    /\bbeat_variants\b/,
    /\bbeats\b/,
    /\bseries\b/,
    /engagement_events/,
    /reward/,
    /policy/,
  ];
  const sqls = [
    brandTableProbeSql("brand_accounts").text,
    brandTableProbeSql("brand_campaigns").text,
    brandTableProbeSql("placement_slots").text,
    brandTableProbeSql("brand_performance").text,
    brandAccountsSql().text,
    brandCampaignsSql().text,
    placementSlotsSql().text,
    brandPerformanceSql().text,
  ];
  for (const sql of sqls) {
    for (const pat of forbidden) {
      assert.doesNotMatch(sql, pat, `brand rail SQL must not reference ${pat} (content/ad firewall): ${sql}`);
    }
  }
});

test("FIREWALL: brand rail reads are SELECT-only and read only the brand rail tables", () => {
  const reads = [brandAccountsSql().text, brandCampaignsSql().text, placementSlotsSql().text, brandPerformanceSql().text];
  for (const sql of reads) {
    assert.match(sql, /^select /i, "brand rail reads are SELECT-only");
    assert.doesNotMatch(sql, /\b(insert|update|delete)\b/i, "no mutation in the brand rail reads");
  }
  assert.match(brandAccountsSql().text, /from brand_accounts/);
  assert.match(brandCampaignsSql().text, /from brand_campaigns/);
  assert.match(placementSlotsSql().text, /from placement_slots/);
  assert.match(brandPerformanceSql().text, /from brand_performance/);
});

test("the table probe reads ONLY information_schema and is parameterized by table name", () => {
  const probe = brandTableProbeSql("brand_accounts");
  assert.match(probe.text, /from information_schema\.tables/);
  assert.match(probe.text, /table_schema = 'mobile'/);
  assert.deepEqual(probe.values, ["brand_accounts"]);
});
