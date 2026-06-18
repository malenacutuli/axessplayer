// Audit sink tests. Assert the InMemory stub appends entries in order, and that the PgAuditSink emits the
// expected append-only INSERT against mobile.admin_audit_log with JSON-serialized before/after. No em
// dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryAuditSink, PgAuditSink, type AuditEntry } from "./audit.js";

const entry: AuditEntry = {
  operatorId: "op-1",
  role: "Admin",
  action: "series.publish",
  target: "series:11111111-1111-1111-1111-111111111111",
  before: { published: false },
  after: { published: true },
};

test("InMemoryAuditSink appends entries in order and exposes a read-only copy", async () => {
  const sink = new InMemoryAuditSink();
  await sink.append(entry);
  await sink.append({ ...entry, action: "series.unpublish" });
  const rows = sink.entries();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].action, "series.publish");
  assert.equal(rows[1].action, "series.unpublish");
  // The returned array is a copy: mutating it does not corrupt the sink.
  (rows as AuditEntry[]).push(entry);
  assert.equal(sink.entries().length, 2);
});

test("PgAuditSink appends one INSERT into mobile.admin_audit_log with serialized snapshots", async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const fakeDb = {
    async query(text: string, values: unknown[]) {
      calls.push({ text, values });
      return { rows: [] };
    },
  };
  const sink = new PgAuditSink(fakeDb as never);
  await sink.append(entry);

  assert.equal(calls.length, 1);
  const { text, values } = calls[0];
  assert.match(text, /insert into mobile\.admin_audit_log/i);
  assert.match(text, /\(operator_id, role, action, target, before, after\)/);
  // No UPDATE/DELETE is ever emitted by the sink.
  assert.doesNotMatch(text, /update|delete/i);
  assert.deepEqual(values, [
    "op-1",
    "Admin",
    "series.publish",
    "series:11111111-1111-1111-1111-111111111111",
    JSON.stringify({ published: false }),
    JSON.stringify({ published: true }),
  ]);
});

test("PgAuditSink serializes null snapshots as SQL NULL", async () => {
  const calls: Array<{ values: unknown[] }> = [];
  const fakeDb = {
    async query(_text: string, values: unknown[]) {
      calls.push({ values });
      return { rows: [] };
    },
  };
  const sink = new PgAuditSink(fakeDb as never);
  await sink.append({ operatorId: "op-2", role: "Owner", action: "x", target: "t" });
  assert.equal(calls[0].values[4], null);
  assert.equal(calls[0].values[5], null);
});
