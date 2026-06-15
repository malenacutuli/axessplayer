// Decision logging. decision_log is append-only and high volume, so decisions are written to a stream
// and batch-loaded, NEVER a synchronous Postgres insert on the serving path (design 5). This module is
// the logging interface plus an in-memory FAKE. No em dashes.
//
// FLAG: the real stream (Kafka/Kinesis/Pub-Sub) and the batch loader into decision_log are NOT built in
// this cut. The interface is real and the handler uses it; the implementation here is an in-memory fake
// that records what would be enqueued. It does NOT write to Postgres. The schema columns it targets all
// already exist: decision_log.{id, user_id, beat_id, served_variant_id, is_control, policy_version,
// propensity}. propensity is the 0005 column.

// One logged decision. Mirrors the decision_log columns this engine writes. reward is left to the
// offline attribution join (design 5), so it is not set on the serving path.
export type DecisionLogRow = {
  id: string; // decision_log.id, the decision_id
  user_id: string;
  beat_id: string;
  served_variant_id: string;
  is_control: boolean;
  policy_version: string;
  propensity: number | null; // 0005 column; null for control and deterministic-fallback decisions
};

export interface DecisionLogger {
  // Returns the decision_id. Non-blocking by contract: the real impl enqueues to a stream and returns
  // immediately; the serving path never waits on a Postgres insert.
  log(row: Omit<DecisionLogRow, "id">): Promise<string>;
}

// In-memory logger. FAKE for this cut. Records each row so tests can assert propensity and
// policy_version were logged. Mints a deterministic-looking decision_id.
export class InMemoryLogger implements DecisionLogger {
  readonly rows: DecisionLogRow[] = [];
  private seq = 0;
  constructor(private readonly idFactory: () => string = () => randomDecisionId()) {}

  async log(row: Omit<DecisionLogRow, "id">): Promise<string> {
    const id = this.idFactory();
    this.rows.push({ id, ...row });
    this.seq++;
    return id;
  }
}

// A UUID-shaped decision id. crypto.randomUUID gives a real uuid that satisfies the contract's
// decision_id format.
export function randomDecisionId(): string {
  return crypto.randomUUID();
}
