// Spend ledger port for companion monetization. Some companion turns / unlocks may cost coins. ALL spend
// goes through the platform coin ledger (services/economy's hardened spend_coins path) via this narrow port:
// this service NEVER mints, debits, or tracks balances itself. It depends on the LedgerPort interface,
// mirroring how the rest of the platform treats the economy plane as authoritative.
//
// WELLBEING (hard, prompt 16): monetization stays inside the anti-dark-pattern policy. There is a SPEND
// COOL-DOWN: a session that just spent cannot spend again until the cool-down elapses, so a companion can
// never engineer a rapid-spend compulsion loop. The cool-down is enforced by the service over the session
// state; this port is the pure ledger interface. No "you will lose the relationship" pressure, no
// variable-reward spend prompts: those are forbidden by policy and not representable here.
//
// The default port is UNWIRED and refuses to spend (default-deny), so an unwired deploy cannot move coins.
// Production injects an economy-backed client. No em dashes.

export interface SpendRequest {
  // The acting viewer (the session subject, resolved from the bearer; never a body field).
  userId: string;
  // Opaque scope id for the thing being unlocked (e.g. a companion content unlock). The economy plane owns
  // the authoritative price; this service does not set it.
  scopeId: string;
  // Idempotency key so a retried turn never double-charges (mirrors economy's client_txn_id).
  clientTxnId: string;
  // ACTOR ROYALTY intent (interface only). The companion's royalty_terms produce an actor split fraction in
  // [0, 1]; the AUTHORITATIVE accrual / payout lives in the economy + settlement planes, which this service
  // does NOT own or write to. It passes the intent through so a wired ledger can record the actor accrual.
  actorRoyaltyShare?: number;
  // Opaque actor payee reference the royalty accrues to (from royalty_terms). Resolved/validated downstream.
  actorPayeeRef?: string | null;
}

export interface SpendResult {
  // The post-spend balance reported by the ledger.
  balance: number;
}

export interface LedgerPort {
  // Spend coins through the authoritative ledger. Throws on insufficient funds / unknown scope (the economy
  // plane's named errors), surfaced to the caller as a refusal rather than a silent success.
  spend(req: SpendRequest): Promise<SpendResult>;
}

export class LedgerUnwiredError extends Error {
  constructor() {
    super("companions: no coin ledger wired; refusing to spend");
    this.name = "LedgerUnwiredError";
  }
}

// Default UNWIRED ledger: every spend throws (default-deny). Production injects an economy-backed client.
export function defaultLedger(): LedgerPort {
  return {
    async spend(): Promise<SpendResult> {
      throw new LedgerUnwiredError();
    },
  };
}

// The spend cool-down window. After a spend, a session cannot spend again until this elapses. A deliberate
// wellbeing brake: it makes a rapid-spend compulsion loop impossible by construction.
export const SPEND_COOLDOWN_MS = 60_000;

// Pure helper: is the session still inside its spend cool-down at `now`? cooldownUntil is the session's
// stored cool-down expiry (null when never spent). Used by the route before any ledger call.
export function inSpendCooldown(cooldownUntil: string | null, now: Date = new Date()): boolean {
  if (cooldownUntil == null) return false;
  const until = Date.parse(cooldownUntil);
  if (Number.isNaN(until)) return false;
  return now.getTime() < until;
}

// The next cool-down expiry after a spend at `now`.
export function nextCooldownUntil(now: Date = new Date()): string {
  return new Date(now.getTime() + SPEND_COOLDOWN_MS).toISOString();
}

// The actor royalty split read off a companion's royalty_terms. The accrual itself is authoritative in the
// economy/settlement planes (NOT owned here); this only resolves the intent the spend carries downstream.
export interface RoyaltyIntent {
  share: number; // fraction in [0, 1]
  payeeRef: string | null;
}

// Resolve the royalty intent from a royalty_terms record. Recognizes { actor_share: number, actor_payee_ref:
// string }. A missing/invalid share is treated as 0 (no accrual), never NaN. Clamped to [0, 1].
export function royaltyIntentFromTerms(terms: Record<string, unknown> | null | undefined): RoyaltyIntent {
  const t = terms ?? {};
  const raw = t.actor_share;
  let share = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  if (share < 0) share = 0;
  if (share > 1) share = 1;
  const payeeRef = typeof t.actor_payee_ref === "string" ? t.actor_payee_ref : null;
  return { share, payeeRef };
}
