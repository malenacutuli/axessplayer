# @axessplayer/observability

Framework-agnostic observability primitives every Axessplayer service can adopt later without
code churn. Four capabilities, all dependency-free and built on Web standard types (`Request`,
`Response`, `Headers`) so they behave the same on Node, the edge worker, and the app.

No live exporter is wired in this package. Real backends (Prometheus, OTel, a log collector)
bind through clearly flagged seams. Nothing here opens a socket or starts a push loop.

## What is in the box

| Capability | Entry points | Default |
| --- | --- | --- |
| Structured JSON logging | `createLogger`, `consoleSink`, `noopSink` | console JSON lines |
| Metrics | `createMetrics`, `InMemoryMetrics`, `MetricsExporter` | in-memory aggregation |
| Trace context | `extractTraceContext`, `injectTraceContext`, `traceHeaders` | W3C `traceparent` + `x-request-id` fallback |
| Health and readiness | `createHealthHandler`, `livenessReport`, `readinessReport` | fetch handler for `/healthz` and `/readyz` |

## Flagged seams (interface vs real)

- Logging is real out of the box (`consoleSink` emits structured JSON; `noopSink` drops). To ship
  logs somewhere, implement the `LogSink` interface and pass it as `createLogger({ sink })`.
- Metrics are real in-memory (counters, gauges, histograms aggregate and are readable via
  `snapshot()`). The `MetricsExporter` interface is the FLAGGED seam for a Prometheus or OTel
  backend. This package ships NO implementation of it; a service or the W11 deploy supplies one
  via `createMetrics({ exporter })`. Until then everything stays in process.

## Adoption guide

Add the workspace dependency to the service `package.json`:

```json
{ "dependencies": { "@axessplayer/observability": "workspace:*" } }
```

### 1. Structured logging with trace correlation

```ts
import { createLogger } from "@axessplayer/observability";

const log = createLogger({ level: "info", base: { service: "decision" } });

// Per request: bind the trace so every line correlates app -> decision -> manifest -> CDN.
const reqLog = log.withTrace(ctx); // ctx from extractTraceContext below
reqLog.info("decided", { decisionId, latencyMs });
```

Each record is a single flat JSON object: `{ ts, level, msg, traceId, spanId, ...fields }`.

### 2. Metrics

```ts
import { createMetrics } from "@axessplayer/observability";

const metrics = createMetrics(); // in-memory default
const decideLatency = metrics.histogram("decide_latency_ms", [5, 10, 25, 50, 100, 250]);
const requests = metrics.counter("requests_total");

requests.inc(1, { route: "/v1/decide" });
decideLatency.observe(elapsedMs);

// Later, W11 or the service binds a real backend without touching the call sites above:
// const metrics = createMetrics({ exporter: myPrometheusAdapter });
```

### 3. Trace context across the fetch boundary

```ts
import { extractTraceContext, traceHeaders } from "@axessplayer/observability";

// Inbound: read or mint a trace context from the request headers.
const ctx = extractTraceContext(req.headers);

// Outbound: propagate it to the next hop.
await fetch(manifestUrl, { headers: { ...traceHeaders(ctx) } });
```

`extractTraceContext` reads W3C `traceparent` first, then `x-request-id` / `x-trace-id`, and
mints a fresh id when nothing is present, so a trace id always exists. Continuing an inbound trace
keeps the trace id and starts a new local span.

### 4. Health and readiness (the W11 contract)

`createHealthHandler` returns a Web fetch handler (`Request => Promise<Response | null>`) matching
the shape services already serve (see `services/manifest/src/server.ts`). Mount it ahead of your
routes and fall through on `null`:

```ts
import { createHealthHandler } from "@axessplayer/observability";

const health = createHealthHandler({
  // Readiness checks. Each may return true/void (healthy) or false/throw (unhealthy);
  // each runs under a timeout so a hung dependency cannot hang the probe.
  checks: [{ name: "db", check: () => db.ping() }],
  timeoutMs: 1000,
});

export const handler = async (req: Request): Promise<Response> => {
  const probe = await health(req);
  if (probe) return probe;        // /healthz or /readyz handled here
  return serveAppRoutes(req);     // everything else
};
```

## Uniform health contract for W11 deploy

Wire the Dockerfile/orchestrator probes to these paths and bodies. They are identical across
every service.

- Liveness `GET /healthz`: process is up. Always `200` with body `{ "status": "healthy",
  "checks": [] }`. Cheap and dependency-free, so a brief downstream outage never kills a healthy
  pod. Use for the container liveness probe / Docker `HEALTHCHECK`.
- Readiness `GET /readyz`: process can serve traffic now. Runs the service checks. `200` with
  `{ "status": "healthy", "checks": [...] }` when all pass; `503` with
  `{ "status": "unhealthy", "checks": [...] }` when any fails or times out. Use for the load
  balancer / readiness probe so traffic drains while a dependency recovers.

Response shape:

```jsonc
// GET /readyz, one dependency down -> HTTP 503
{
  "status": "unhealthy",
  "checks": [
    { "name": "db", "status": "unhealthy", "durationMs": 1001, "error": "timed out after 1000ms" }
  ]
}
```

Both responses set `Cache-Control: no-store`.

## Testing

```
pnpm --filter @axessplayer/observability test
```

Unit tests live beside the code (`src/*.test.ts`) and run on `node --test` + `tsx`, matching the
monorepo convention.
