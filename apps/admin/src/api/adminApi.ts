// ADMIN API client. Bound to the ADMIN API CONTRACT over VITE_ADMIN_API_BASE_URL with an operator bearer
// token. Every endpoint is operator-authed and RBAC-gated server side; this client only carries the
// bearer and shapes the typed responses. The base url is injected through VITE_ADMIN_API_BASE_URL so one
// build can point at mocks, staging, or production; the dev default is the same-origin "/admin" prefix
// that the Vite dev proxy forwards to the local content service. No em dashes.

/* ----------------------------------- Roles ----------------------------------- */
// The eight operator roles from the contract. RBAC is enforced server side; the UI mirrors it (see
// src/access/rbac.ts) so a viewer never sees a control they cannot use.
export type OperatorRole =
  | "Owner"
  | "Admin"
  | "Content"
  | "Finance"
  | "Marketing"
  | "Moderation"
  | "Support"
  | "ReadOnly";

export interface Operator {
  id: string;
  name: string;
  email: string;
}

// GET /admin/me
export interface AdminMe {
  operator: Operator;
  role: OperatorRole;
}

/* --------------------------------- Dashboard --------------------------------- */
// GET /admin/dashboard. Each KPI carries the route it drills through to (drillTo), so a card click opens
// its filtered report. A trend may be a point string OR a counterfactual band (always shown as a band,
// never a point, per the hard gate).
export interface KpiBand {
  low: number;
  high: number;
  center?: number;
  label?: string;
}
export interface DashboardKpi {
  key: string;
  label: string;
  value: string;
  trend?: string;
  // Optional counterfactual interval. When present the card renders a LiftBand, never a single number.
  band?: KpiBand;
  // Route this card drills through to (a filtered report route). No dead end: the target always renders.
  drillTo: string;
  tone?: "neutral" | "gold" | "green";
}
export interface DashboardSeriesPoint {
  label: string;
  // Stacked revenue-by-source segments (or any banded series), rendered as bands, not points.
  segments: Array<{ key: string; value: number }>;
}
export interface DashboardSeries {
  key: string;
  label: string;
  points: DashboardSeriesPoint[];
}
export interface AdminDashboard {
  kpis: DashboardKpi[];
  topSeries: DashboardSeries[];
}

/* ---------------------------------- Content ---------------------------------- */
export type ContentStatus = "live" | "review" | "processing" | "draft" | "failed";
export type ContentKind = "channel" | "series" | "episode" | "variant";

// A node in the content entity tree (channel -> series -> episode -> variant). The list/tree from
// GET /admin/content; the same shape is returned for a detail node from GET /admin/content/:id.
export interface ContentNode {
  id: string;
  kind: ContentKind;
  title: string;
  status: ContentStatus;
  channel?: string;
  variantCount?: number;
  a11yCoverage?: number; // 0..100
  provenanceVerified?: boolean;
  children?: ContentNode[];
}
export interface AdminContentList {
  tree: ContentNode[];
}
export interface AdminContentDetail {
  node: ContentNode;
  // Read-only this wave. Editing + publish states come later; the UI shows them disabled with a
  // "coming soon" affordance (no dead end).
  meta: Array<{ label: string; value: string }>;
}

/* ----------------------------------- Client ---------------------------------- */
export interface AdminApiConfig {
  baseUrl: string;
  // The operator bearer token. Real operator MFA is a CUTOVER GATE (see src/access). In dev a static
  // demo operator token is used so the console renders for review.
  token: string;
  fetchImpl?: typeof fetch;
}

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export class AdminApi {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AdminApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
    this.fetchImpl =
      config.fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : (undefined as never));
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        // Identity is the session subject, carried as the operator bearer, never a request body field.
        Authorization: `Bearer ${this.token}`,
      },
    });
    if (!res.ok) {
      throw new AdminApiError(res.status, `GET ${path} failed with ${res.status}`);
    }
    return (await res.json()) as T;
  }

  // GET /admin/me -> { operator, role }
  me(): Promise<AdminMe> {
    return this.get<AdminMe>("/admin/me");
  }

  // GET /admin/dashboard -> { kpis, topSeries }
  dashboard(): Promise<AdminDashboard> {
    return this.get<AdminDashboard>("/admin/dashboard");
  }

  // GET /admin/content -> the entity tree/list (channels->series->episodes->variants) with status
  content(): Promise<AdminContentList> {
    return this.get<AdminContentList>("/admin/content");
  }

  // GET /admin/content/:id -> detail
  contentDetail(id: string): Promise<AdminContentDetail> {
    return this.get<AdminContentDetail>(`/admin/content/${encodeURIComponent(id)}`);
  }
}

// Resolve the ADMIN API base url from the runtime env. Defaults to the same-origin "/admin" prefix that
// the Vite dev proxy forwards to the local content service.
type EnvBag = Record<string, string | undefined>;
function readEnv(): EnvBag {
  const metaEnv = (import.meta as unknown as { env?: EnvBag }).env;
  return metaEnv ?? {};
}
export function resolveAdminBaseUrl(env: EnvBag = readEnv()): string {
  return env.VITE_ADMIN_API_BASE_URL ?? "/admin";
}
// The operator bearer. In dev a static demo token is used; production injects a real operator session
// token (MFA-backed) through VITE_ADMIN_OPERATOR_TOKEN.
export function resolveOperatorToken(env: EnvBag = readEnv()): string {
  return env.VITE_ADMIN_OPERATOR_TOKEN ?? "demo-operator-token";
}
