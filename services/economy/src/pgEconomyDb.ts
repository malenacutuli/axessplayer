// Production EconomyDB over node-postgres. The handler depends only on the EconomyDB interface; this is
// the real adapter. It runs under the service role (per migration 0003, only service_role may execute
// spend_coins). The `userId` it receives is always the session subject the handler was given. No em dashes.

import type pg from "pg";
import type { EconomyDB, GrantType, Scope, Wallet } from "./economy.js";

export class PgEconomyDb implements EconomyDB {
  constructor(private readonly db: Pick<pg.Pool, "query">) {}

  async getWallet(userId: string): Promise<Wallet | null> {
    const w = await this.db.query(
      "select balance, bonus_balance from public.coin_wallet where user_id = $1",
      [userId]
    );
    if (w.rows.length === 0) return null;
    const ents = await this.db.query(
      "select scope, scope_id from public.entitlements where user_id = $1 order by granted_at",
      [userId]
    );
    return {
      user_id: userId,
      balance: Number(w.rows[0].balance),
      bonus_balance: Number(w.rows[0].bonus_balance),
      entitlements: ents.rows.map((r) => ({ scope: r.scope as Scope, scope_id: r.scope_id as string })),
    };
  }

  async spend(userId: string, scope: Scope, scopeId: string, clientTxnId: string): Promise<number> {
    const r = await this.db.query("select spend_coins($1, $2, $3, $4) as total", [
      userId,
      scope,
      scopeId,
      clientTxnId,
    ]);
    return Number(r.rows[0].total);
  }

  async grant(userId: string, amount: number, type: GrantType, clientTxnId: string): Promise<number> {
    const r = await this.db.query("select grant_coins($1, $2, $3, $4) as total", [
      userId,
      amount,
      type,
      clientTxnId,
    ]);
    return Number(r.rows[0].total);
  }
}
