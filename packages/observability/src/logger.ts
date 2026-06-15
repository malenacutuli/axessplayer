// Structured JSON logger. Emits one flat JSON object per record (level, message, timestamp,
// arbitrary fields, and trace correlation) so log pipelines can index it without parsing.
//
// Defaults are intentionally boring and dependency-free:
//   - `consoleSink` writes JSON lines to stdout/stderr (the default).
//   - `noopSink` drops everything (use in tests or when a service opts out).
// A service can supply its own sink later (ship to a collector) without touching call sites.
// No live exporter is wired here. No em dashes.

import type { TraceContext } from "./trace.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// A single structured record. `fields` is merged flat into the emitted object, so a record
// reads as one JSON object: { ts, level, msg, traceId, spanId, ...fields }.
export interface LogRecord {
  readonly ts: string;
  readonly level: LogLevel;
  readonly msg: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly fields: Record<string, unknown>;
}

// A sink receives finished records. Keeping this an interface means the default console
// behaviour and a future collector are the same shape to the logger.
export interface LogSink {
  emit(record: LogRecord): void;
}

export interface LoggerOptions {
  // Minimum level to emit. Records below this are dropped before reaching the sink.
  readonly level?: LogLevel;
  // Where records go. Defaults to `consoleSink`.
  readonly sink?: LogSink;
  // Fields attached to every record from this logger (for example service name, version).
  readonly base?: Record<string, unknown>;
  // Trace correlation applied to every record. Usually set per request via `withTrace`.
  readonly trace?: Pick<TraceContext, "traceId" | "spanId">;
  // Clock seam for deterministic tests.
  readonly now?: () => Date;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  // Derive a child logger with extra base fields merged in.
  child(fields: Record<string, unknown>): Logger;
  // Derive a child logger bound to a request's trace context, so every record correlates.
  withTrace(trace: Pick<TraceContext, "traceId" | "spanId">): Logger;
}

// Default sink: one JSON line per record. Errors and warnings go to stderr, the rest to stdout,
// matching common log-routing expectations. Serialization is defensive against cyclic fields.
export const consoleSink: LogSink = {
  emit(record: LogRecord): void {
    const line = safeStringify(flatten(record));
    if (record.level === "error" || record.level === "warn") {
      process.stderr.write(line + "\n");
    } else {
      process.stdout.write(line + "\n");
    }
  },
};

// No-op sink: drops every record. Useful in tests or to silence a service entirely.
export const noopSink: LogSink = {
  emit(): void {
    // intentionally empty
  },
};

// Flatten a record into the emitted JSON object. Reserved keys win over field keys so a
// stray `level` in fields cannot shadow the real level.
export function flatten(record: LogRecord): Record<string, unknown> {
  const out: Record<string, unknown> = { ...record.fields };
  out.ts = record.ts;
  out.level = record.level;
  out.msg = record.msg;
  if (record.traceId !== undefined) out.traceId = record.traceId;
  if (record.spanId !== undefined) out.spanId = record.spanId;
  return out;
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "bigint") return val.toString();
    if (val instanceof Error) {
      return { name: val.name, message: val.message, stack: val.stack };
    }
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[circular]";
      seen.add(val);
    }
    return val;
  });
}

class StructuredLogger implements Logger {
  private readonly minLevel: number;
  private readonly sink: LogSink;
  private readonly base: Record<string, unknown>;
  private readonly trace?: Pick<TraceContext, "traceId" | "spanId">;
  private readonly now: () => Date;

  constructor(opts: LoggerOptions) {
    this.minLevel = LEVEL_ORDER[opts.level ?? "info"];
    this.sink = opts.sink ?? consoleSink;
    this.base = opts.base ?? {};
    this.trace = opts.trace;
    this.now = opts.now ?? (() => new Date());
  }

  private log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;
    const record: LogRecord = {
      ts: this.now().toISOString(),
      level,
      msg,
      traceId: this.trace?.traceId,
      spanId: this.trace?.spanId,
      fields: { ...this.base, ...(fields ?? {}) },
    };
    this.sink.emit(record);
  }

  debug(msg: string, fields?: Record<string, unknown>): void {
    this.log("debug", msg, fields);
  }
  info(msg: string, fields?: Record<string, unknown>): void {
    this.log("info", msg, fields);
  }
  warn(msg: string, fields?: Record<string, unknown>): void {
    this.log("warn", msg, fields);
  }
  error(msg: string, fields?: Record<string, unknown>): void {
    this.log("error", msg, fields);
  }

  child(fields: Record<string, unknown>): Logger {
    return new StructuredLogger({
      level: levelFromOrder(this.minLevel),
      sink: this.sink,
      base: { ...this.base, ...fields },
      trace: this.trace,
      now: this.now,
    });
  }

  withTrace(trace: Pick<TraceContext, "traceId" | "spanId">): Logger {
    return new StructuredLogger({
      level: levelFromOrder(this.minLevel),
      sink: this.sink,
      base: this.base,
      trace,
      now: this.now,
    });
  }
}

function levelFromOrder(order: number): LogLevel {
  for (const [name, value] of Object.entries(LEVEL_ORDER) as [LogLevel, number][]) {
    if (value === order) return name;
  }
  return "info";
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  return new StructuredLogger(opts);
}
