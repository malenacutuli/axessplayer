// @axessplayer/observability: framework-agnostic observability primitives every service can adopt
// without code churn. Four capabilities: structured logging, metrics, trace-context propagation,
// and health/readiness handlers. No live exporter is wired here; real backends bind via flagged
// seams (see metrics MetricsExporter and the logger LogSink). No em dashes.

export {
  createLogger,
  consoleSink,
  noopSink,
  flatten,
  type Logger,
  type LoggerOptions,
  type LogLevel,
  type LogRecord,
  type LogSink,
} from "./logger.js";

export {
  createMetrics,
  InMemoryMetrics,
  DEFAULT_BUCKETS,
  type Metrics,
  type MetricsOptions,
  type MetricsExporter,
  type Counter,
  type Gauge,
  type Histogram,
  type Labels,
  type MetricsSnapshot,
  type CounterSnapshot,
  type GaugeSnapshot,
  type HistogramSnapshot,
} from "./metrics.js";

export {
  extractTraceContext,
  injectTraceContext,
  traceHeaders,
  parseTraceparent,
  formatTraceparent,
  newTraceId,
  newSpanId,
  TRACEPARENT_HEADER,
  REQUEST_ID_HEADER,
  TRACE_ID_HEADER,
  type TraceContext,
  type HeaderReader,
} from "./trace.js";

export {
  createHealthHandler,
  livenessReport,
  readinessReport,
  type HealthStatus,
  type HealthCheck,
  type CheckResult,
  type HealthReport,
  type HealthHandlerOptions,
} from "./health.js";
