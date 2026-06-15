// Metrics interface plus an in-memory default.
//
// `Metrics` is the surface every service codes against: counters, gauges, histograms, each
// keyed by name plus an optional label set. Two implementations ship here:
//
//   - `InMemoryMetrics` (the default): aggregates in process and exposes `snapshot()` so tests
//     and a future scrape endpoint can read current values. No IO, no exporter.
//
//   - `RealBackendMetrics` is NOT provided as a live exporter. The `MetricsExporter` interface
//     below is the FLAGGED seam where a Prometheus or OTel backend is bound LATER. Until a service
//     supplies one, `createMetrics()` returns the in-memory implementation. Nothing here opens a
//     socket, starts a push loop, or imports a vendor SDK.
//
// No em dashes.

// Label sets are small string maps. They are part of a metric's identity, so two increments with
// the same name but different labels are tracked separately (Prometheus semantics).
export type Labels = Record<string, string>;

export interface Counter {
  // Add `value` (default 1, must be >= 0) to the series identified by `labels`.
  inc(value?: number, labels?: Labels): void;
}

export interface Gauge {
  // Replace the current value for `labels`.
  set(value: number, labels?: Labels): void;
  // Adjust the current value up or down.
  add(delta: number, labels?: Labels): void;
}

export interface Histogram {
  // Record one observation into the configured buckets for `labels`.
  observe(value: number, labels?: Labels): void;
}

export interface Metrics {
  counter(name: string, help?: string): Counter;
  gauge(name: string, help?: string): Gauge;
  // Buckets are the upper bounds; observations also feed an implicit +Inf bucket plus sum/count.
  histogram(name: string, buckets?: number[], help?: string): Histogram;
}

// ---- Snapshot shapes (what the in-memory backend exposes for reads) ----

export interface CounterSnapshot {
  readonly name: string;
  readonly help?: string;
  readonly series: Array<{ labels: Labels; value: number }>;
}

export interface GaugeSnapshot {
  readonly name: string;
  readonly help?: string;
  readonly series: Array<{ labels: Labels; value: number }>;
}

export interface HistogramSnapshot {
  readonly name: string;
  readonly help?: string;
  readonly buckets: number[];
  readonly series: Array<{
    labels: Labels;
    // Cumulative count per bucket upper bound, plus running sum and total count.
    bucketCounts: number[];
    sum: number;
    count: number;
  }>;
}

export interface MetricsSnapshot {
  readonly counters: CounterSnapshot[];
  readonly gauges: GaugeSnapshot[];
  readonly histograms: HistogramSnapshot[];
}

// ---- FLAGGED seam for a real backend ----
//
// A service that wants real metrics implements this interface against its chosen backend
// (Prometheus client, OTel meter, statsd, ...) and passes it to `createMetrics({ exporter })`.
// This package deliberately ships NO implementation of it: wiring a live exporter is a service
// or W11 deploy concern, not this package's. The shape mirrors the three instrument kinds so an
// adapter is a thin pass-through.
export interface MetricsExporter {
  onCounterInc(name: string, value: number, labels: Labels, help?: string): void;
  onGaugeSet(name: string, value: number, labels: Labels, help?: string): void;
  onGaugeAdd(name: string, delta: number, labels: Labels, help?: string): void;
  onHistogramObserve(name: string, value: number, buckets: number[], labels: Labels, help?: string): void;
}

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

// Stable key for a label set so series identity is order-independent.
function labelKey(labels: Labels | undefined): string {
  if (!labels) return "";
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${labels[k]}`).join(",");
}

function parseLabelKey(key: string): Labels {
  if (key === "") return {};
  const out: Labels = {};
  for (const pair of key.split(",")) {
    const eq = pair.indexOf("=");
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

interface HistogramState {
  buckets: number[];
  series: Map<string, { bucketCounts: number[]; sum: number; count: number }>;
  help?: string;
}

// In-memory aggregating backend. This is the default. It never performs IO. `snapshot()` returns
// a plain readable view for tests and a future pull endpoint; `reset()` clears state for tests.
export class InMemoryMetrics implements Metrics {
  private readonly exporter?: MetricsExporter;
  private readonly counters = new Map<string, { help?: string; series: Map<string, number> }>();
  private readonly gauges = new Map<string, { help?: string; series: Map<string, number> }>();
  private readonly histograms = new Map<string, HistogramState>();

  constructor(exporter?: MetricsExporter) {
    this.exporter = exporter;
  }

  counter(name: string, help?: string): Counter {
    if (!this.counters.has(name)) this.counters.set(name, { help, series: new Map() });
    const entry = this.counters.get(name)!;
    const exporter = this.exporter;
    return {
      inc(value = 1, labels?: Labels): void {
        if (value < 0) throw new Error(`counter ${name} cannot be incremented by a negative value`);
        const key = labelKey(labels);
        entry.series.set(key, (entry.series.get(key) ?? 0) + value);
        exporter?.onCounterInc(name, value, labels ?? {}, help);
      },
    };
  }

  gauge(name: string, help?: string): Gauge {
    if (!this.gauges.has(name)) this.gauges.set(name, { help, series: new Map() });
    const entry = this.gauges.get(name)!;
    const exporter = this.exporter;
    return {
      set(value: number, labels?: Labels): void {
        entry.series.set(labelKey(labels), value);
        exporter?.onGaugeSet(name, value, labels ?? {}, help);
      },
      add(delta: number, labels?: Labels): void {
        const key = labelKey(labels);
        entry.series.set(key, (entry.series.get(key) ?? 0) + delta);
        exporter?.onGaugeAdd(name, delta, labels ?? {}, help);
      },
    };
  }

  histogram(name: string, buckets: number[] = DEFAULT_BUCKETS, help?: string): Histogram {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, { buckets: [...buckets].sort((a, b) => a - b), series: new Map(), help });
    }
    const entry = this.histograms.get(name)!;
    const exporter = this.exporter;
    return {
      observe(value: number, labels?: Labels): void {
        const key = labelKey(labels);
        let s = entry.series.get(key);
        if (!s) {
          s = { bucketCounts: new Array(entry.buckets.length).fill(0), sum: 0, count: 0 };
          entry.series.set(key, s);
        }
        for (let i = 0; i < entry.buckets.length; i += 1) {
          if (value <= entry.buckets[i]) s.bucketCounts[i] += 1;
        }
        s.sum += value;
        s.count += 1;
        exporter?.onHistogramObserve(name, value, entry.buckets, labels ?? {}, help);
      },
    };
  }

  snapshot(): MetricsSnapshot {
    const counters: CounterSnapshot[] = [];
    for (const [name, e] of this.counters) {
      counters.push({
        name,
        help: e.help,
        series: [...e.series].map(([k, value]) => ({ labels: parseLabelKey(k), value })),
      });
    }
    const gauges: GaugeSnapshot[] = [];
    for (const [name, e] of this.gauges) {
      gauges.push({
        name,
        help: e.help,
        series: [...e.series].map(([k, value]) => ({ labels: parseLabelKey(k), value })),
      });
    }
    const histograms: HistogramSnapshot[] = [];
    for (const [name, e] of this.histograms) {
      histograms.push({
        name,
        help: e.help,
        buckets: e.buckets,
        series: [...e.series].map(([k, s]) => ({
          labels: parseLabelKey(k),
          bucketCounts: [...s.bucketCounts],
          sum: s.sum,
          count: s.count,
        })),
      });
    }
    return { counters, gauges, histograms };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

export interface MetricsOptions {
  // Optional FLAGGED real-backend adapter. When omitted, metrics stay purely in-memory.
  readonly exporter?: MetricsExporter;
}

// Factory. Returns the in-memory backend, optionally mirroring writes to a flagged exporter.
// There is deliberately no path here that constructs a live Prometheus or OTel exporter.
export function createMetrics(opts: MetricsOptions = {}): InMemoryMetrics {
  return new InMemoryMetrics(opts.exporter);
}

export { DEFAULT_BUCKETS };
