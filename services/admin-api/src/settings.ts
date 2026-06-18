// Admin settings read models for section 17:
//   - GET /admin/settings/audit : a PAGED read of mobile.admin_audit_log (the immutable audit trail),
//     ordered ts DESC (newest first). The table is QUEUED in scripts/sql/07_admin_audit.sql and may be
//     UNAPPLIED on the hosted project, so a tolerant catalog probe decides between a real read and an empty
//     + source:"unwired" page (audit rows are NEVER fabricated). limit/offset page the trail.
//   - GET /admin/settings/roles : the RBAC matrix as a READ MODEL derived from rbac.ts (rolesMatrix()), the
//     8 roles x route capabilities. No re-declaration of policy; the surfaced grid is the same MATRIX the
//     decide() gate enforces, so it can never drift.
//
// Feature-flag toggles are 501 RBAC-gated audit seams in http/app.ts (Owner/Admin write). No em dashes.

import type { QueryPort } from "./aggregate.js";
import { adminAuditTableProbeSql, adminAuditPageSql, adminAuditCountSql, type Sql } from "./queries.js";
import { rolesMatrix, ROLES, type RoleCapabilities } from "./rbac.js";

async function run<T = Record<string, unknown>>(db: QueryPort, sql: Sql): Promise<T[]> {
  const r = await db.query(sql.text, sql.values as unknown[]);
  return r.rows as T[];
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));

// ---- Audit page (GET /admin/settings/audit) ---------------------------------------------------------

// One audit row as surfaced to the console. before/after are the JSON snapshots (or null). ts is an ISO
// string. This mirrors the immutable mobile.admin_audit_log row shape, read-only.
export interface AuditRow {
  id: string;
  ts: string;
  operatorId: string;
  role: string;
  action: string;
  target: string;
  before: unknown;
  after: unknown;
}

export interface AuditPage {
  rows: AuditRow[];
  total: number;
  limit: number;
  offset: number;
  // "unwired" until scripts/sql/07_admin_audit.sql is applied; "hosted" once the table exists. Empty +
  // unwired is the honest answer pre-apply, never fabricated audit rows.
  source: "unwired" | "hosted";
  note: string;
}

// Page-window bounds. The page never unbounded-scans the trail: limit is clamped to a sane max, offset to a
// non-negative floor. Mirrors the users-list clamp discipline.
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

export function clampOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset <= 0) return 0;
  return Math.floor(offset);
}

const AUDIT_UNWIRED_NOTE =
  "mobile.admin_audit_log is not applied on this project (queued in scripts/sql/07_admin_audit.sql); the audit page is empty and unwired (rows are never fabricated). Applying the additive table swaps source to hosted with no shape change";

interface AuditDbRow {
  id: string;
  ts: string | Date;
  operator_id: string;
  role: string;
  action: string;
  target: string;
  before: unknown;
  after: unknown;
}

const isoTs = (v: string | Date): string => (v instanceof Date ? v.toISOString() : String(v));

// Build the paged audit view. PROBES for the table first; absent -> empty + unwired (no fabricated rows,
// no error on a missing relation). Present -> the ts-DESC page + total count. The probe reads only
// information_schema, so it is safe on a pre-apply project.
export async function buildAuditPage(db: QueryPort, limitRaw: number, offsetRaw: number): Promise<AuditPage> {
  const limit = clampLimit(limitRaw);
  const offset = clampOffset(offsetRaw);

  const probe = await run<{ table_name: string }>(db, adminAuditTableProbeSql());
  if (probe.length === 0) {
    return { rows: [], total: 0, limit, offset, source: "unwired", note: AUDIT_UNWIRED_NOTE };
  }

  const [rows, countRows] = await Promise.all([
    run<AuditDbRow>(db, adminAuditPageSql(limit, offset)),
    run<{ n: number }>(db, adminAuditCountSql()),
  ]);

  return {
    rows: rows.map((r) => ({
      id: String(r.id),
      ts: isoTs(r.ts),
      operatorId: String(r.operator_id),
      role: String(r.role),
      action: String(r.action),
      target: String(r.target),
      before: r.before ?? null,
      after: r.after ?? null,
    })),
    total: num(countRows[0]?.n),
    limit,
    offset,
    source: "hosted",
    note: "paged read of the immutable mobile.admin_audit_log, newest first",
  };
}

// ---- Roles matrix read model (GET /admin/settings/roles) --------------------------------------------

export interface RolesView {
  // The 8 operator roles, surfaced so the console can render the row headers without re-deriving them.
  roles: readonly string[];
  // The full role x route capability grid, derived from the live RBAC MATRIX (single source of truth).
  matrix: RoleCapabilities[];
  source: "derived";
  note: string;
}

// Build the roles read model. PURE: no DB. Derived directly from rbac.ts so the surfaced grid is always in
// lock-step with the enforced policy (it reads the same MATRIX decide() reads).
export function buildRolesView(): RolesView {
  return {
    roles: ROLES,
    matrix: rolesMatrix(),
    source: "derived",
    note: "RBAC matrix derived from rbac.ts (the 8 roles x route capabilities); this is the same MATRIX the decide() gate enforces, so the surfaced grid can never drift from policy",
  };
}
