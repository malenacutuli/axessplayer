// Trust aggregate tests: the consent view is minimized (scope/expiry/status only) and empty + unwired when
// no consent table exists (never fabricated consent rows); provenance probes the c2pa columns and reads the
// signing rollup defensively; the GDPR queue is empty + unwired. No live Postgres. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { consentTableProbeSql, provenanceColumnsProbeSql, provenanceRollupSql } from "./queries.js";
import { buildConsentView, buildProvenanceView, buildGdprQueue, buildTrust } from "./trust.js";
import type { QueryPort } from "./aggregate.js";

function fakePg(answers: Array<{ match: RegExp; rows: unknown[] }>): QueryPort {
  return {
    async query(text: string) {
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  } as unknown as QueryPort;
}

test("consent probe + rollup SQL read information_schema and the c2pa columns", () => {
  assert.match(consentTableProbeSql().text, /from information_schema\.tables/);
  assert.match(provenanceColumnsProbeSql().text, /from information_schema\.columns/);
  assert.match(provenanceColumnsProbeSql().text, /c2pa_signed/);
  // The provenance rollup reads ONLY the c2pa/provenance columns, never PII/playback urls.
  const rollup = provenanceRollupSql().text;
  assert.match(rollup, /from beat_variants/);
  assert.match(rollup, /c2pa_signed/);
  assert.doesNotMatch(rollup, /playback_url/);
});

test("consent view is MINIMIZED and empty + unwired when no consent table exists", async () => {
  const db = fakePg([{ match: /information_schema\.tables/, rows: [] }]);
  const v = await buildConsentView(db);
  assert.deepEqual(v.entries, []);
  assert.equal(v.source, "unwired");
  assert.equal(v.minimized, true);
});

test("provenance is unwired when the c2pa_signed column is absent (substrate not applied)", async () => {
  const db = fakePg([{ match: /information_schema\.columns/, rows: [] }]);
  const v = await buildProvenanceView(db);
  assert.equal(v.source, "unwired");
  assert.deepEqual(v.sample, []);
  assert.equal(v.rollup.total, 0);
});

test("provenance reads the c2pa signing rollup + sample when the columns exist", async () => {
  const db = fakePg([
    { match: /information_schema\.columns/, rows: [{ column_name: "c2pa_signed" }] },
    { match: /count\(\*\)::int as total/, rows: [{ total: 10, signed: 4, with_manifest: 4, with_provenance: 6 }] },
    {
      match: /id as variant_id/,
      rows: [{ variant_id: "v1", c2pa_signed: true, has_manifest: true, has_provenance: true, article50_ai_label: "ai-generated" }],
    },
  ]);
  const v = await buildProvenanceView(db);
  assert.equal(v.source, "hosted");
  assert.equal(v.rollup.total, 10);
  assert.equal(v.rollup.signed, 4);
  assert.equal(v.sample[0].variantId, "v1");
  assert.equal(v.sample[0].c2paSigned, true);
  assert.equal(v.sample[0].aiLabel, "ai-generated");
});

test("GDPR queue is empty + unwired and issues NO query (no request source to read)", async () => {
  const throwing = { async query() { throw new Error("gdpr queue must not query without a request source"); } } as unknown as QueryPort;
  const v = await buildGdprQueue(throwing);
  assert.deepEqual(v.requests, []);
  assert.equal(v.source, "unwired");
});

test("buildTrust composes consent + provenance + gdpr", async () => {
  const db = fakePg([
    { match: /information_schema\.tables/, rows: [] },
    { match: /information_schema\.columns/, rows: [] },
  ]);
  const t = await buildTrust(db);
  assert.equal(t.consent.source, "unwired");
  assert.equal(t.provenance.source, "unwired");
  assert.equal(t.gdpr.source, "unwired");
});
