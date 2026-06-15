// Unit tests for metrics: counters/gauges/histograms aggregate correctly, labels separate series,
// the in-memory snapshot is readable, and the flagged exporter seam receives mirrored writes
// without this package ever opening a live exporter. Runner: node --test + tsx. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createMetrics, InMemoryMetrics, type MetricsExporter } from "./metrics.js";

test("counter accumulates and separates by labels", () => {
  const m = createMetrics();
  const c = m.counter("requests_total", "total requests");
  c.inc();
  c.inc(2);
  c.inc(1, { route: "/decide" });
  const snap = m.snapshot();
  const series = snap.counters[0].series;
  const noLabels = series.find((s) => Object.keys(s.labels).length === 0);
  const decide = series.find((s) => s.labels.route === "/decide");
  assert.equal(noLabels?.value, 3);
  assert.equal(decide?.value, 1);
  assert.equal(snap.counters[0].help, "total requests");
});

test("counter rejects negative increments", () => {
  const m = createMetrics();
  const c = m.counter("x");
  assert.throws(() => c.inc(-1), /negative/);
});

test("gauge set replaces and add adjusts", () => {
  const m = createMetrics();
  const g = m.gauge("inflight");
  g.set(5);
  g.add(2);
  g.add(-3);
  const value = m.snapshot().gauges[0].series[0].value;
  assert.equal(value, 4);
});

test("histogram buckets are cumulative with correct sum and count", () => {
  const m = createMetrics();
  const h = m.histogram("latency_ms", [10, 50, 100]);
  h.observe(5);
  h.observe(40);
  h.observe(75);
  h.observe(500);
  const snap = m.snapshot().histograms[0];
  assert.deepEqual(snap.buckets, [10, 50, 100]);
  const s = snap.series[0];
  // <=10: {5} = 1 ; <=50: {5,40} = 2 ; <=100: {5,40,75} = 3
  assert.deepEqual(s.bucketCounts, [1, 2, 3]);
  assert.equal(s.count, 4);
  assert.equal(s.sum, 620);
});

test("histogram sorts unordered buckets", () => {
  const m = createMetrics();
  const h = m.histogram("h", [100, 10, 50]);
  h.observe(40);
  assert.deepEqual(m.snapshot().histograms[0].buckets, [10, 50, 100]);
});

test("reset clears all series", () => {
  const m = new InMemoryMetrics();
  m.counter("c").inc();
  m.reset();
  assert.equal(m.snapshot().counters.length, 0);
});

test("flagged exporter seam receives mirrored writes", () => {
  const calls: string[] = [];
  const exporter: MetricsExporter = {
    onCounterInc: (name, value) => calls.push(`counter:${name}:${value}`),
    onGaugeSet: (name, value) => calls.push(`gauge.set:${name}:${value}`),
    onGaugeAdd: (name, delta) => calls.push(`gauge.add:${name}:${delta}`),
    onHistogramObserve: (name, value) => calls.push(`hist:${name}:${value}`),
  };
  const m = createMetrics({ exporter });
  m.counter("c").inc(3);
  m.gauge("g").set(1);
  m.gauge("g").add(2);
  m.histogram("h", [1]).observe(0.5);
  assert.deepEqual(calls, ["counter:c:3", "gauge.set:g:1", "gauge.add:g:2", "hist:h:0.5"]);
  // In-memory aggregation still works alongside the mirror.
  assert.equal(m.snapshot().counters[0].series[0].value, 3);
});
