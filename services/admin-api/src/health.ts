// Service-status read model for GET /admin/health (section 16). Composes a static SERVICE REGISTRY of the
// known platform services with QoE + error-rate PLACEHOLDERS, a job-failures block, and active alerts.
//
// HARD RULE for this wave: this builder does NOT call the live services. There are no cross-service health
// pings (no fetch to content/decision/economy/manifest/settlement or the new services). It returns a static
// registry whose per-service liveness is "unwired" (status: "unknown") and a followup to wire REAL health
// checks. Fabricating a green "healthy" for a service we never pinged would be dishonest, so every entry is
// honestly "unknown" with source:"unwired" until a real probe lands.
//
// The job-failures block reads no jobs table (none exists in the hosted schema), so it is unwired-honest:
// an empty failures list + source:"unwired", never a fabricated failure count. Active alerts are similarly
// empty + unwired until an alerting source is wired. No em dashes.

// The 5 LIVE services (never touched by this service) plus the new/undeployed services. The registry is a
// static catalog of WHAT exists; per-service liveness is unwired this wave (no ping is issued).
export interface ServiceStatus {
  // The service id (matches the deployed service / package name).
  id: string;
  label: string;
  // Whether this is one of the 5 live (deployed) services or a new/undeployed one. Surfaced so the console
  // can render the deploy boundary; it is NOT a liveness signal.
  kind: "live" | "new";
  // Liveness. "unknown" until a real health check is wired. We never claim "healthy" without a ping.
  status: "healthy" | "degraded" | "down" | "unknown";
  // QoE + error-rate PLACEHOLDERS. null (not 0) so the console renders "no data" rather than a fabricated
  // perfect score. A real health/QoE source fills these without a shape change.
  qoeScore: number | null;
  errorRatePct: number | null;
  // The liveness source. "unwired" until a real probe lands.
  source: "unwired" | "live";
}

// The known services. The 5 LIVE services first (content/decision/economy/manifest/settlement), then the
// new services (identity/catalog/library/experiment/events/recap/admin-api). admin-api is THIS service.
export const KNOWN_SERVICES: ReadonlyArray<{ id: string; label: string; kind: "live" | "new" }> = [
  { id: "content", label: "Content service", kind: "live" },
  { id: "decision", label: "Decision engine", kind: "live" },
  { id: "economy", label: "Economy service", kind: "live" },
  { id: "manifest", label: "Manifest service", kind: "live" },
  { id: "settlement", label: "Settlement service", kind: "live" },
  { id: "identity", label: "Identity service", kind: "new" },
  { id: "catalog", label: "Catalog service", kind: "new" },
  { id: "library", label: "Library service", kind: "new" },
  { id: "experiment", label: "Experiment service", kind: "new" },
  { id: "events", label: "Events service", kind: "new" },
  { id: "recap", label: "Recap service", kind: "new" },
  { id: "admin-api", label: "Admin API (this service)", kind: "new" },
];

// One job-failure summary line. Empty in the unwired case (no jobs table). Never fabricated.
export interface JobFailure {
  jobId: string;
  kind: string;
  failedAt: string;
  reason: string;
}

export interface JobFailuresBlock {
  failures: JobFailure[];
  // The failure count over the reporting window. 0 in the unwired case (no jobs table to read), flagged by
  // source so the console does not read it as "zero failures observed".
  windowFailureCount: number;
  source: "unwired" | "hosted";
  note: string;
}

// One active alert. Empty + unwired until an alerting source is wired.
export interface ActiveAlert {
  id: string;
  severity: "info" | "warning" | "critical";
  service: string;
  message: string;
  raisedAt: string;
}

export interface AlertsBlock {
  alerts: ActiveAlert[];
  source: "unwired" | "hosted";
  note: string;
}

export interface HealthView {
  services: ServiceStatus[];
  jobFailures: JobFailuresBlock;
  alerts: AlertsBlock;
  // The registry liveness source for the whole view, reaffirming no cross-service ping was issued.
  source: "unwired";
  note: string;
  // A followup to wire real per-service health checks, surfaced in the payload so the unwired state is
  // explicit to a console author rather than silently green.
  followup: string;
}

const HEALTH_NOTE =
  "service health is a STATIC registry this wave; no cross-service health ping is issued (the admin API never calls the 5 live services). Per-service liveness is unknown + source:unwired until real health checks are wired, never a fabricated healthy";

const JOB_FAILURES_UNWIRED_NOTE =
  "no jobs table in the hosted schema; job failures are empty and unwired (never a fabricated failure count)";

const ALERTS_UNWIRED_NOTE =
  "no alerting source is wired; active alerts are empty and unwired (alerts are never fabricated)";

const HEALTH_FOLLOWUP =
  "wire real per-service health checks (a liveness/QoE probe per service) so status/qoeScore/errorRatePct reflect observed health instead of the static unwired registry";

// Build the health view. PURE: no DB access and NO cross-service ping. Returns the static registry with
// honestly-unwired liveness, an empty unwired job-failures block, and empty unwired alerts. The shape is
// real so wiring a probe is a data swap, never a shape change.
export function buildHealth(): HealthView {
  return {
    services: KNOWN_SERVICES.map((s) => ({
      id: s.id,
      label: s.label,
      kind: s.kind,
      status: "unknown",
      qoeScore: null,
      errorRatePct: null,
      source: "unwired",
    })),
    jobFailures: {
      failures: [],
      windowFailureCount: 0,
      source: "unwired",
      note: JOB_FAILURES_UNWIRED_NOTE,
    },
    alerts: {
      alerts: [],
      source: "unwired",
      note: ALERTS_UNWIRED_NOTE,
    },
    source: "unwired",
    note: HEALTH_NOTE,
    followup: HEALTH_FOLLOWUP,
  };
}
