// Postgres-backed wiring for the decision service's engine ports. The decision service ships the engine
// (decide.ts) plus in-memory FAKES for its ports (InMemoryKV, InMemoryLogger, InMemoryCohortSeeds) and a
// DB stub in its tests; it does not ship a node-postgres DecisionDB or a decision_log writer (the real
// stream + batch loader are flagged as out of this cut in logger.ts). This is HARNESS WIRING (not a
// service change):
//
//   PgDecisionDB     implements the engine's DecisionDB port over the real Postgres (beats, beat_edges,
//                    beat_variants, users, viewer_state). It only reads; it never alters the schema.
//   PgDecisionLogger implements the DecisionLogger port by writing a real decision_log row (the brief
//                    requires a decision_log row, with propensity for the treatment arm). It mints the
//                    decision_id with gen_random_uuid via RETURNING id.
//   seedTenseArm     primes the bandit's KV so a treatment viewer at intensity 5 is served the TENSE cut.
//                    With cold identity priors every arm ties and the deterministic tie-break picks the
//                    lower variant id (CALM), so to exercise the treatment arm's tense outcome the TENSE
//                    arm model is trained for a high-intensity context, exactly as decide.test.ts does
//                    ("trained arm shifts the choice"). This is serving-layer setup, not an engine change.
//
// No em dashes.

import type pg from "pg";

import type { DecisionDB, DecideDeps } from "../../../services/decision/src/decide.js";
import type { CanonCandidate, CanonFacts } from "../../../services/decision/src/canon.js";
import type { Branch } from "../../../services/decision/src/policy.js";
import {
  type DecisionLogger,
  type DecisionLogRow,
} from "../../../services/decision/src/logger.js";
import { InMemoryKV } from "../../../services/decision/src/kv.js";
import { InMemoryCohortSeeds, zeroVector, toArray } from "../../../services/decision/src/features.js";
import { InMemoryTrainer } from "../../../services/decision/src/bandit.js";
import { policyVersion } from "../../../services/decision/src/config.js";

const TENSE = "cccccccc-0000-0000-0000-00000000000b";

// The engine's DecisionDB port over real Postgres. Reads the content graph and per-viewer system of
// record. Candidates are the valid beat_edges successors of the current beat, each tagged with the
// branch its edge condition names and the single variant on the successor beat.
export class PgDecisionDb implements DecisionDB {
  constructor(private readonly db: Pick<pg.Pool, "query">) {}

  async seriesOfBeat(beatId: string): Promise<string> {
    const r = await this.db.query("select series_id from public.beats where id = $1", [beatId]);
    if (r.rows.length === 0) throw new Error("unknown_beat");
    return r.rows[0].series_id as string;
  }

  // Resolve successor candidates: for each beat_edges row out of this beat, take the (single) variant on
  // the destination beat and tag it with the branch from the edge condition. validEdge is true because
  // the rows come straight from beat_edges; the canon filter is the gate, not this read.
  async candidatesOf(beatId: string): Promise<CanonCandidate[]> {
    const r = await this.db.query(
      `select e.to_beat_id, e.condition, v.id as variant_id
         from public.beat_edges e
         join public.beat_variants v on v.beat_id = e.to_beat_id
        where e.from_beat_id = $1
        order by v.id`,
      [beatId]
    );
    return r.rows.map((row) => {
      const condition = (row.condition ?? {}) as Record<string, unknown>;
      const branch = (condition.branch === "tense" ? "tense" : "calm") as Branch;
      return { variantId: row.variant_id as string, branch, validEdge: true };
    });
  }

  async canonFactsOf(beatId: string): Promise<CanonFacts> {
    const r = await this.db.query("select canon_facts from public.beats where id = $1", [beatId]);
    return ((r.rows[0]?.canon_facts ?? {}) as CanonFacts);
  }

  async cohortOf(userId: string, seriesId: string): Promise<string | null> {
    const r = await this.db.query(
      "select cohort_id from public.viewer_state where user_id = $1 and series_id = $2",
      [userId, seriesId]
    );
    return (r.rows[0]?.cohort_id as string | null) ?? null;
  }

  async adaptiveOptIn(userId: string): Promise<boolean> {
    const r = await this.db.query("select adaptive_opt_in from public.users where id = $1", [userId]);
    return r.rows[0]?.adaptive_opt_in !== false;
  }
}

// Writes a real decision_log row and returns its id (the decision_id). The engine guarantees the column
// set: id, user_id, beat_id, served_variant_id, is_control, policy_version, propensity (the 0005 column).
export class PgDecisionLogger implements DecisionLogger {
  constructor(private readonly db: Pick<pg.Pool, "query">) {}

  async log(row: Omit<DecisionLogRow, "id">): Promise<string> {
    const r = await this.db.query(
      `insert into public.decision_log
         (user_id, beat_id, served_variant_id, is_control, policy_version, propensity)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [
        row.user_id,
        row.beat_id,
        row.served_variant_id,
        row.is_control,
        row.policy_version,
        row.propensity,
      ]
    );
    return r.rows[0].id as string;
  }
}

// Prime the KV so the bandit serves TENSE to a high-intensity treatment viewer. Cold priors tie and the
// deterministic tie-break picks the lower variant id (CALM); training the TENSE arm for the high-intensity
// context lets it win on the exploitation term. Same LinUCB update the decision unit tests use.
export async function seedTenseArm(kv: InMemoryKV): Promise<void> {
  const trainer = new InMemoryTrainer();
  // A high-intensity context: a treatment viewer whose vector reflects intensity 5 and high completion.
  const x = toArray({ ...zeroVector(), intensity_ema: 1, completion_rate: 1 });
  const models = await trainer.train([
    { variantId: TENSE, x, reward: 1 },
    { variantId: TENSE, x, reward: 1 },
    { variantId: TENSE, x, reward: 1 },
  ]);
  await kv.putArmModel(TENSE, policyVersion(), models.get(TENSE)!);
}

// Assemble the full DecideDeps the HTTP adapter needs: the Postgres DB and logger above, plus the KV
// (with the TENSE arm primed) and the cohort seeds. The KV is returned too so the harness can inspect it.
export async function makeDecisionDeps(pool: pg.Pool): Promise<DecideDeps> {
  const kv = new InMemoryKV();
  await seedTenseArm(kv);
  return {
    db: new PgDecisionDb(pool),
    kv,
    logger: new PgDecisionLogger(pool),
    cohorts: new InMemoryCohortSeeds(),
  };
}
