// Postgres-backed decision source. Reads decision_log (including the 0005 propensity column) from a REAL
// Postgres database, READ-ONLY. This is the honest ingestion path the off-policy estimators run against,
// not the in-memory fake. No em dashes.
//
// What is REAL here: the SELECT against decision_log runs on an actual Postgres server (the embedded-
// postgres harness in tests, a warehouse replica in production). The columns id, user_id, beat_id,
// served_variant_id, is_control, policy_version, propensity, reward are read verbatim.
//
// What is SUPPLIED, and why: the walking-skeleton schema (migrations 0001..0005) stores the attributed
// reward as a JSONB `reward` column and does NOT persist the per-decision feature vector or the canon-
// filtered arm set on decision_log. Off-policy evaluation needs the context x and the arm set to recompute
// a candidate's action distribution. So this source reads what the table HAS and delegates deriving
// (context, armSet, outcome) to an injected enricher. In production that enricher is the warehouse join
// (decision_log -> viewer_state snapshot, beat_edges, attributed outcome events). The enricher boundary
// is FLAGGED: the DB read is real; how context/armSet/outcome are reconstructed is the join you wire.

import type { LoggedDecision } from "./dataset.js";
import type { AttributedOutcome } from "./reward-weights.js";
import type { DecisionSource } from "./dataset.js";

// The raw decision_log row as it exists in the schema (0001 + 0005).
export type DecisionLogRow = {
  id: string;
  user_id: string;
  beat_id: string;
  served_variant_id: string;
  is_control: boolean;
  policy_version: string | null;
  propensity: number | null; // 0005 column
  reward: unknown; // JSONB; shape is the attribution job's concern, decoded by the enricher
};

// Minimal query interface so this works over node-postgres (pg.Pool) or any compatible client without a
// hard dependency. Matches pg.Pool.query's relevant shape.
export interface SqlClient {
  query<R>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

// Reconstructs the off-policy fields the bare table does not carry. In tests this returns the synthetic
// context/armSet/outcome that produced the row; in production it is the warehouse join. FLAGGED boundary.
export type DecisionEnricher = (row: DecisionLogRow) => {
  context: number[];
  armSet: string[];
  outcome: AttributedOutcome;
};

// Reads decision_log from a real Postgres and maps each row to a LoggedDecision via the enricher. Rows
// with a null propensity that are NOT control are skipped with a count, because a non-control decision
// without a logged propensity is not usable for honest IPS (it would mean the logging policy did not
// record how it chose, which the 0005 column exists to prevent).
export class PgDecisionSource implements DecisionSource {
  public skippedNullPropensity = 0;

  constructor(
    private readonly sql: SqlClient,
    private readonly enrich: DecisionEnricher,
    private readonly opts: { limit?: number } = {}
  ) {}

  async load(): Promise<LoggedDecision[]> {
    this.skippedNullPropensity = 0;
    const limit = this.opts.limit ?? 100_000;
    const { rows } = await this.sql.query<DecisionLogRow>(
      `SELECT id, user_id, beat_id, served_variant_id, is_control, policy_version, propensity, reward
         FROM decision_log
        ORDER BY created_at ASC, id ASC
        LIMIT $1`,
      [limit]
    );
    const out: LoggedDecision[] = [];
    for (const row of rows) {
      if (!row.is_control && (row.propensity === null || row.propensity === undefined)) {
        this.skippedNullPropensity++;
        continue;
      }
      const e = this.enrich(row);
      out.push({
        decisionId: row.id,
        userId: row.user_id,
        beatId: row.beat_id,
        variantId: row.served_variant_id,
        propensity: row.is_control ? 1 : Number(row.propensity),
        policyVersion: row.policy_version ?? "unknown",
        isControl: row.is_control,
        context: e.context,
        armSet: e.armSet,
        outcome: e.outcome,
      });
    }
    return out;
  }
}
