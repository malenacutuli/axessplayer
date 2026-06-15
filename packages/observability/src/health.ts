// Health and readiness helpers: a framework-agnostic handler factory returning a uniform
// `{ status, checks }` contract for `/healthz` (liveness) and `/readyz` (readiness).
//
// The factory produces a Web fetch handler (`Request => Promise<Response>`), the same shape the
// services already serve (see services/manifest/src/server.ts). That means a service mounts these
// without an adapter, and W11 Dockerfiles/deploy can point liveness/readiness probes at a uniform
// path and JSON body across every service.
//
// Liveness (`/healthz`): the process is up. No dependency checks; it must stay cheap and never fail
// because a downstream is briefly unavailable, otherwise an orchestrator would kill a healthy pod.
//
// Readiness (`/readyz`): the process can serve traffic right now. This runs the supplied checks
// (for example a DB ping). Any failing or timed-out check makes the whole response `unhealthy`
// with HTTP 503, so a load balancer stops routing until it recovers.
//
// No live dependency is assumed; checks are callbacks the service supplies. No em dashes.

export type HealthStatus = "healthy" | "unhealthy";

// One dependency probe. `check` resolves true (or void) for healthy, throws or resolves false for
// unhealthy. It is wrapped in a timeout so a hung dependency cannot hang the probe.
export interface HealthCheck {
  readonly name: string;
  check(): Promise<boolean | void> | boolean | void;
  // Per-check timeout in ms. Defaults to `HealthHandlerOptions.timeoutMs`.
  readonly timeoutMs?: number;
}

export interface CheckResult {
  readonly name: string;
  readonly status: HealthStatus;
  readonly durationMs: number;
  readonly error?: string;
}

export interface HealthReport {
  readonly status: HealthStatus;
  readonly checks: CheckResult[];
}

export interface HealthHandlerOptions {
  // Readiness checks. Liveness ignores these by design.
  readonly checks?: HealthCheck[];
  // Default per-check timeout in ms. Defaults to 1000.
  readonly timeoutMs?: number;
  // Route paths. Defaults to /healthz and /readyz.
  readonly livenessPath?: string;
  readonly readinessPath?: string;
  // Clock seam for deterministic duration in tests.
  readonly now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 1000;

function jsonResponse(report: HealthReport): Response {
  const code = report.status === "healthy" ? 200 : 503;
  return new Response(JSON.stringify(report), {
    status: code,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Run one check under a timeout, never throwing. A thrown error or a `false` result is unhealthy;
// `true`/`undefined` is healthy. A timeout is reported as a distinct error string.
async function runCheck(check: HealthCheck, defaultTimeout: number, now: () => number): Promise<CheckResult> {
  const start = now();
  const timeoutMs = check.timeoutMs ?? defaultTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    const result = await Promise.race([Promise.resolve(check.check()), timeout]);
    const ok = result === undefined || result === true;
    return {
      name: check.name,
      status: ok ? "healthy" : "unhealthy",
      durationMs: now() - start,
      ...(ok ? {} : { error: "check returned false" }),
    };
  } catch (err) {
    return {
      name: check.name,
      status: "unhealthy",
      durationMs: now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// Liveness report is always healthy with no checks: reaching this code means the process runs.
export function livenessReport(): HealthReport {
  return { status: "healthy", checks: [] };
}

// Readiness report: run all checks concurrently; the overall status is unhealthy if any fails.
export async function readinessReport(opts: HealthHandlerOptions = {}): Promise<HealthReport> {
  const checks = opts.checks ?? [];
  const now = opts.now ?? (() => Date.now());
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results = await Promise.all(checks.map((c) => runCheck(c, timeoutMs, now)));
  const status: HealthStatus = results.every((r) => r.status === "healthy") ? "healthy" : "unhealthy";
  return { status, checks: results };
}

// Build a Web fetch handler that serves liveness and readiness on their paths. Returns null for
// any other path so a service can fall through to its own routes, for example:
//   const health = createHealthHandler({ checks: [{ name: "db", check: () => db.ping() }] });
//   const res = await health(req); if (res) return res; // else handle app routes
export function createHealthHandler(
  opts: HealthHandlerOptions = {},
): (req: Request) => Promise<Response | null> {
  const livenessPath = opts.livenessPath ?? "/healthz";
  const readinessPath = opts.readinessPath ?? "/readyz";
  return async (req: Request): Promise<Response | null> => {
    const { pathname } = new URL(req.url);
    if (pathname === livenessPath) {
      return jsonResponse(livenessReport());
    }
    if (pathname === readinessPath) {
      return jsonResponse(await readinessReport(opts));
    }
    return null;
  };
}
