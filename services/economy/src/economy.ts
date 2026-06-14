// Economy service handlers for /wallet and /spend, mirroring economy.yaml 0.3.2.
// Framework-agnostic: each handler takes the acting user id as an explicit parameter (the session
// subject, resolved by the HTTP layer from the auth token) plus injected DB access. There is no user_id
// in any request body, which is the F1 trust boundary made structural: a handler physically cannot act
// on a client-supplied identity. The HTTP adapter (Hono/Express/Fastify) is a thin wrapper over these.
// No em dashes.

export type Scope = "episode" | "beat_variant";

export interface Entitlement {
  scope: Scope;
  scope_id: string;
}
export interface Wallet {
  user_id: string;
  balance: number;
  bonus_balance: number;
  entitlements: Entitlement[];
}
export interface SpendBody {
  scope: Scope;
  scope_id: string;
  client_txn_id: string;
}
export interface PaywallOptions {
  error: string;
  options: Array<"buy" | "watch_ad" | "subscribe">;
}
export interface ApiError {
  error: string;
}
export interface SpendOk {
  balance: number;
  entitlement: Entitlement;
}

export interface HandlerResult<T> {
  status: number;
  body: T;
}

// Injected data access. The handlers never build SQL; they call these. `spend` calls the hardened
// spend_coins RPC and surfaces its named errors (insufficient_funds, unknown_scope_id, invalid_scope,
// no_wallet) by throwing an Error whose message contains that token.
export interface EconomyDB {
  getWallet(userId: string): Promise<Wallet | null>;
  spend(userId: string, scope: Scope, scopeId: string, clientTxnId: string): Promise<number>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /wallet : self-scoped. userId is the session subject, never a path or body value.
export async function handleGetWallet(
  userId: string,
  db: EconomyDB
): Promise<HandlerResult<Wallet | ApiError>> {
  const wallet = await db.getWallet(userId);
  if (!wallet) return { status: 404, body: { error: "no_wallet" } };
  return { status: 200, body: wallet };
}

// POST /spend : the acting user is `userId` (the session subject). The body carries scope, scope_id,
// client_txn_id only. Server-authoritative price and idempotency live in spend_coins.
export async function handleSpend(
  userId: string,
  body: SpendBody,
  db: EconomyDB
): Promise<HandlerResult<SpendOk | PaywallOptions | ApiError>> {
  if (body == null || (body.scope !== "episode" && body.scope !== "beat_variant")) {
    return { status: 400, body: { error: "invalid_scope" } };
  }
  if (typeof body.scope_id !== "string" || !UUID_RE.test(body.scope_id)) {
    return { status: 400, body: { error: "invalid_scope_id" } };
  }
  if (typeof body.client_txn_id !== "string" || body.client_txn_id.length === 0) {
    return { status: 400, body: { error: "missing_client_txn_id" } };
  }

  try {
    const balance = await db.spend(userId, body.scope, body.scope_id, body.client_txn_id);
    return {
      status: 200,
      body: { balance, entitlement: { scope: body.scope, scope_id: body.scope_id } },
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/insufficient_funds/.test(m)) {
      return { status: 402, body: { error: "insufficient_funds", options: ["buy", "watch_ad", "subscribe"] } };
    }
    if (/unknown_scope_id/.test(m)) return { status: 404, body: { error: "unknown_scope_id" } };
    if (/no_wallet/.test(m)) return { status: 404, body: { error: "no_wallet" } };
    if (/invalid_scope/.test(m)) return { status: 400, body: { error: "invalid_scope" } };
    if (/invalid_price/.test(m)) return { status: 409, body: { error: "invalid_price" } };
    throw e; // unknown failure: let it surface as a 500 at the adapter
  }
}
