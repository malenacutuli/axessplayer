// Health registry tests (section 16). The view is a STATIC registry: it lists every known service (the 5
// live + the new services), issues NO cross-service ping, and reports per-service liveness honestly as
// "unknown" + source:"unwired" (never a fabricated healthy). Job failures + alerts are empty + unwired.
// No live Postgres, no fetch. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildHealth, KNOWN_SERVICES } from "./health.js";

const LIVE_SERVICES = ["content", "decision", "economy", "manifest", "settlement"];
const NEW_SERVICES = ["identity", "catalog", "library", "experiment", "events", "recap", "admin-api"];

test("health registry lists all known services (5 live + new) and never pings them", () => {
  const v = buildHealth();
  const ids = v.services.map((s) => s.id);
  for (const id of [...LIVE_SERVICES, ...NEW_SERVICES]) {
    assert.ok(ids.includes(id), `expected service ${id} in the registry`);
  }
  // The registry knows which are the 5 live services (the deploy boundary), surfaced as kind:"live".
  const liveIds = v.services.filter((s) => s.kind === "live").map((s) => s.id);
  assert.deepEqual(liveIds.sort(), [...LIVE_SERVICES].sort());
});

test("every service is honestly unknown + unwired (no fabricated healthy, no ping issued)", () => {
  const v = buildHealth();
  assert.equal(v.source, "unwired");
  for (const s of v.services) {
    assert.equal(s.status, "unknown");
    assert.equal(s.source, "unwired");
    // QoE + error-rate are null (no data), NEVER a fabricated 0/100 perfect score.
    assert.equal(s.qoeScore, null);
    assert.equal(s.errorRatePct, null);
  }
  // The followup to wire real health checks is surfaced in the payload.
  assert.match(v.followup, /health check/i);
});

test("job failures are unwired-honest (empty, zero count, source unwired)", () => {
  const v = buildHealth();
  assert.deepEqual(v.jobFailures.failures, []);
  assert.equal(v.jobFailures.windowFailureCount, 0);
  assert.equal(v.jobFailures.source, "unwired");
});

test("active alerts are empty + unwired (never fabricated)", () => {
  const v = buildHealth();
  assert.deepEqual(v.alerts.alerts, []);
  assert.equal(v.alerts.source, "unwired");
});

test("KNOWN_SERVICES is a stable non-empty catalog", () => {
  assert.ok(KNOWN_SERVICES.length >= LIVE_SERVICES.length + NEW_SERVICES.length);
});
