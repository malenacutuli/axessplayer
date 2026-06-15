// Unit tests for health/readiness: liveness always healthy, readiness reflects checks, failing and
// timed-out checks flip the status to unhealthy with HTTP 503, and the fetch handler routes the two
// paths and falls through otherwise. Runner: node --test + tsx. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createHealthHandler,
  livenessReport,
  readinessReport,
  type HealthCheck,
} from "./health.js";

function req(path: string): Request {
  return new Request(`http://svc.local${path}`);
}

test("liveness report is always healthy with no checks", () => {
  const r = livenessReport();
  assert.equal(r.status, "healthy");
  assert.deepEqual(r.checks, []);
});

test("readiness is healthy when all checks pass", async () => {
  const checks: HealthCheck[] = [
    { name: "db", check: () => true },
    { name: "cache", check: async () => undefined },
  ];
  const r = await readinessReport({ checks });
  assert.equal(r.status, "healthy");
  assert.equal(r.checks.length, 2);
  assert.ok(r.checks.every((c) => c.status === "healthy"));
});

test("readiness is unhealthy when a check returns false", async () => {
  const r = await readinessReport({ checks: [{ name: "db", check: () => false }] });
  assert.equal(r.status, "unhealthy");
  assert.equal(r.checks[0].status, "unhealthy");
  assert.equal(r.checks[0].error, "check returned false");
});

test("readiness is unhealthy when a check throws, capturing the message", async () => {
  const r = await readinessReport({
    checks: [
      {
        name: "db",
        check: () => {
          throw new Error("connection refused");
        },
      },
    ],
  });
  assert.equal(r.status, "unhealthy");
  assert.equal(r.checks[0].error, "connection refused");
});

test("readiness times out a hung check and marks it unhealthy", async () => {
  const hung: HealthCheck = {
    name: "slow",
    timeoutMs: 20,
    check: () => new Promise<boolean>(() => {}), // never resolves
  };
  const r = await readinessReport({ checks: [hung] });
  assert.equal(r.status, "unhealthy");
  assert.match(r.checks[0].error ?? "", /timed out/);
});

test("handler serves /healthz with 200 and a healthy body", async () => {
  const handler = createHealthHandler({ checks: [{ name: "db", check: () => false }] });
  const res = await handler(req("/healthz"));
  assert.ok(res);
  assert.equal(res.status, 200);
  const body = await res.json();
  // Liveness ignores readiness checks by design.
  assert.equal(body.status, "healthy");
  assert.deepEqual(body.checks, []);
});

test("handler serves /readyz with 503 when a check fails", async () => {
  const handler = createHealthHandler({ checks: [{ name: "db", check: () => false }] });
  const res = await handler(req("/readyz"));
  assert.ok(res);
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const body = await res.json();
  assert.equal(body.status, "unhealthy");
});

test("handler serves /readyz with 200 when checks pass", async () => {
  const handler = createHealthHandler({ checks: [{ name: "db", check: () => true }] });
  const res = await handler(req("/readyz"));
  assert.equal(res?.status, 200);
});

test("handler returns null for unknown paths so the service can fall through", async () => {
  const handler = createHealthHandler();
  const res = await handler(req("/v1/decide"));
  assert.equal(res, null);
});

test("custom paths are honoured", async () => {
  const handler = createHealthHandler({ livenessPath: "/live", readinessPath: "/ready" });
  assert.equal((await handler(req("/live")))?.status, 200);
  assert.equal((await handler(req("/ready")))?.status, 200);
  assert.equal(await handler(req("/healthz")), null);
});
