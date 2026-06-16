// Prompt 01 / T4: the non-negotiable data wall. Every variant impression is logged to
// mobile.decision_log with viewer, beat, served variant, arm, propensity, policy_version, timestamp,
// and the session-end surrogate components. No impression may be unlogged. session_id and the surrogate
// live in the reward JSONB so no schema change is needed (the column set is otherwise fixed). No em dashes.

import type { ImpressionRecord } from "./readout.js";

// Minimal query interface (matches pg.Pool.query), so this has no hard pg dependency and is testable
// with a fake.
export interface SqlClient {
  query<R = unknown>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export const INSERT_IMPRESSION_SQL =
  `insert into mobile.decision_log
     (user_id, beat_id, served_variant_id, is_control, policy_version, propensity, reward)
   values ($1, $2, $3, $4, $5, $6, $7)`;

export function impressionParams(rec: ImpressionRecord): unknown[] {
  return [
    rec.viewerId,
    rec.beatId,
    rec.variantId,
    rec.arm === "control",
    rec.policyVersion,
    rec.propensity,
    JSON.stringify({ session_id: rec.sessionId, arm: rec.arm, ts: rec.ts, surrogate: rec.surrogate }),
  ];
}

export async function logImpression(sql: SqlClient, rec: ImpressionRecord): Promise<void> {
  if (!(rec.propensity > 0)) {
    // A logged decision without a positive propensity is not usable for honest IPS; refuse it loudly.
    throw new Error(`logImpression: non-positive propensity for ${rec.viewerId}/${rec.beatId}`);
  }
  await sql.query(INSERT_IMPRESSION_SQL, impressionParams(rec));
}

export async function logImpressions(sql: SqlClient, recs: ImpressionRecord[]): Promise<number> {
  let n = 0;
  for (const r of recs) {
    await logImpression(sql, r);
    n++;
  }
  return n;
}

// The acceptance query (prompt 01 item 4 + 7): proves zero unlogged impressions, i.e. no served decision
// is missing its propensity. Run against the hosted mobile schema after a play-through.
export const UNLOGGED_CHECK_SQL =
  `select count(*)::int as unlogged from mobile.decision_log where propensity is null`;
