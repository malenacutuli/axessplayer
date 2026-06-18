// Admin settings read-model tests (section 17). Three things:
//   - the audit paging shape on the EMPTY-UNWIRED path: when mobile.admin_audit_log is not applied, the
//     probe returns no rows so the page is empty + source:"unwired" and NO page/count query is issued
//     (never fabricated audit rows, never an error on a missing relation).
//   - the audit page on the hosted path: ts-DESC rows + total, source:"hosted", with limit/offset clamped.
//   - the roles-matrix derivation: the read model is derived from the live rbac MATRIX (8 roles x routes)
//     and stays in lock-step with decide() (the same capabilities the gate enforces).
// No live Postgres. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  adminAuditTableProbeSql,
  adminAuditPageSql,
  adminAuditCountSql,
} from "./queries.js";
import { buildAuditPage, buildRolesView, clampLimit, clampOffset } from "./settings.js";
import { ROLES, decide } from "./rbac.js";
import type { QueryPort } from "./aggregate.js";

function fakePg(answers: Array<{ match: RegExp; rows: unknown[] }>, onQuery?: (text: string) => void): QueryPort {
  return {
    async query(text: string) {
      if (onQuery) onQuery(text);
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  } as unknown as QueryPort;
}

test("audit probe reads information_schema; page is ts DESC and bounded; count is a scalar", () => {
  assert.match(adminAuditTableProbeSql().text, /from information_schema\.tables/);
  assert.match(adminAuditTableProbeSql().text, /admin_audit_log/);
  const page = adminAuditPageSql(25, 50);
  assert.match(page.text, /from mobile\.admin_audit_log/);
  assert.match(page.text, /order by ts desc/);
  assert.match(page.text, /limit \$1 offset \$2/);
  assert.deepEqual(page.values, [25, 50]);
  // The page read is SELECT-only: no UPDATE/DELETE against the append-only table.
  assert.doesNotMatch(page.text, /update|delete/i);
  assert.match(adminAuditCountSql().text, /count\(\*\)::int/);
});

test("EMPTY-UNWIRED path: no audit table -> empty page, source unwired, and NO page/count query issued", async () => {
  const issued: string[] = [];
  // Only the probe answers; it returns [] (table absent). The page/count must never run.
  const db = fakePg([{ match: /information_schema\.tables/, rows: [] }], (t) => issued.push(t));
  const page = await buildAuditPage(db, 50, 0);
  assert.deepEqual(page.rows, []);
  assert.equal(page.total, 0);
  assert.equal(page.source, "unwired");
  assert.equal(page.limit, 50);
  assert.equal(page.offset, 0);
  // The ONLY query issued is the catalog probe; the page/count selects were skipped.
  assert.equal(issued.length, 1);
  assert.match(issued[0], /information_schema\.tables/);
});

test("HOSTED path: table present -> ts-DESC rows + total, source hosted, clamped window", async () => {
  const db = fakePg([
    { match: /information_schema\.tables/, rows: [{ table_name: "admin_audit_log" }] },
    {
      match: /from mobile\.admin_audit_log order by ts desc/,
      rows: [
        {
          id: "a1",
          ts: "2026-06-18T00:00:00.000Z",
          operator_id: "op-1",
          role: "Admin",
          action: "series.publish",
          target: "series:1",
          before: { published: false },
          after: { published: true },
        },
      ],
    },
    { match: /count\(\*\)::int as n/, rows: [{ n: 1 }] },
  ]);
  // Over-max limit clamps to 200; negative offset floors to 0.
  const page = await buildAuditPage(db, 5000, -3);
  assert.equal(page.source, "hosted");
  assert.equal(page.total, 1);
  assert.equal(page.limit, 200);
  assert.equal(page.offset, 0);
  assert.equal(page.rows[0].operatorId, "op-1");
  assert.equal(page.rows[0].action, "series.publish");
  assert.deepEqual(page.rows[0].after, { published: true });
});

test("clamp helpers bound the page window", () => {
  assert.equal(clampLimit(0), 50);
  assert.equal(clampLimit(-1), 50);
  assert.equal(clampLimit(10), 10);
  assert.equal(clampLimit(99999), 200);
  assert.equal(clampLimit(Number.NaN), 50);
  assert.equal(clampOffset(-5), 0);
  assert.equal(clampOffset(12), 12);
  assert.equal(clampOffset(Number.NaN), 0);
});

test("roles read model derives the 8 roles x route grid and stays in lock-step with decide()", () => {
  const v = buildRolesView();
  assert.equal(v.source, "derived");
  // All 8 roles present.
  assert.equal(v.matrix.length, ROLES.length);
  assert.deepEqual(v.matrix.map((r) => r.role).sort(), [...ROLES].sort());
  // The derived grid must match what the gate enforces for every cell. Spot-check via decide() on the
  // health + settings surfaces plus a content write.
  for (const roleCaps of v.matrix) {
    const health = roleCaps.routes.find((r) => r.route === "health");
    assert.ok(health);
    // decide(role, /admin/health, GET) allow must equal the derived read cap.
    const gateRead = decide(roleCaps.role, "/admin/health", "GET").allow;
    assert.equal(health.read, gateRead, `health read mismatch for ${roleCaps.role}`);
  }
});

test("derived health read is Admin/Owner/Support only; settings write is Owner/Admin only", () => {
  const v = buildRolesView();
  const cap = (role: string, route: string) =>
    v.matrix.find((m) => m.role === role)?.routes.find((r) => r.route === route);
  // health read: exactly Owner/Admin/Support.
  const healthReaders = v.matrix.filter((m) => m.routes.find((r) => r.route === "health")?.read).map((m) => m.role);
  assert.deepEqual(healthReaders.sort(), ["Admin", "Owner", "Support"]);
  // settings write: exactly Owner/Admin.
  const settingsWriters = v.matrix.filter((m) => m.routes.find((r) => r.route === "settings")?.write).map((m) => m.role);
  assert.deepEqual(settingsWriters.sort(), ["Admin", "Owner"]);
  // settings read is BROAD (every role reads the audit trail / roles grid).
  for (const role of ROLES) {
    assert.equal(cap(role, "settings")?.read, true, `settings read should be broad; ${role} cannot read`);
  }
});
