// Immutable admin audit log. Every mutating admin request appends one row recording who did what, when,
// against which target, with the before/after snapshots. This wave ships only read endpoints, so nothing
// appends yet, but the seam is built end to end so the first mutating route inherits a real, append-only
// audit trail rather than bolting one on later.
//
// The sink is an interface (AdminAuditSink). Two implementations ship:
//   - PgAuditSink writes mobile.admin_audit_log (the additive table in scripts/sql/07_admin_audit.sql).
//   - InMemoryAuditSink collects entries in an array for tests and local wiring.
//
// Append-only is enforced at the database (the table forbids UPDATE/DELETE, see the SQL script) and is
// respected here: the sink exposes only append. There is deliberately no update or delete method. No em
// dashes.

import type pg from "pg";
import type { Role } from "./rbac.js";

// One audit entry. `before`/`after` are JSON snapshots of the mutated target (null on a create or when a
// snapshot is not applicable). `target` is a stable identifier of the thing acted on (for example
// "series:<id>"). `action` is the operation name (for example "series.publish").
export interface AuditEntry {
  operatorId: string;
  role: Role;
  action: string;
  target: string;
  before?: unknown;
  after?: unknown;
}

export interface AdminAuditSink {
  // Append one entry. Resolves when the entry is durable (for Pg) or stored (for InMemory). Append is the
  // only mutation the sink offers: the log is immutable by construction.
  append(entry: AuditEntry): Promise<void>;
}

// Postgres-backed sink. Inserts into mobile.admin_audit_log. The table is created by the additive script
// scripts/sql/07_admin_audit.sql (NOT executed by this service; the main loop applies it). The insert
// self-qualifies the schema so it is immune to the connection search_path.
export class PgAuditSink implements AdminAuditSink {
  constructor(private readonly db: Pick<pg.Pool, "query">) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.db.query(
      `insert into mobile.admin_audit_log (operator_id, role, action, target, before, after)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        entry.operatorId,
        entry.role,
        entry.action,
        entry.target,
        entry.before == null ? null : JSON.stringify(entry.before),
        entry.after == null ? null : JSON.stringify(entry.after),
      ],
    );
  }
}

// In-memory sink for tests and local wiring. Records appends in order. Read via entries(); there is no
// way to mutate or remove a recorded entry, mirroring the immutability of the real table.
export class InMemoryAuditSink implements AdminAuditSink {
  private readonly rows: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    this.rows.push(entry);
  }

  entries(): readonly AuditEntry[] {
    return this.rows.slice();
  }
}
