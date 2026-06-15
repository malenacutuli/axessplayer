// Wallet display. Shows the balance, bonus balance, and the viewer's entitlements from /wallet. The
// balance is read from the server, never computed client-side as truth (golden rule 5). No em dashes.

import type { Wallet as WalletData } from "../api/economy.js";

export interface WalletProps {
  wallet: WalletData | null;
  loading?: boolean;
}

export function Wallet({ wallet, loading }: WalletProps) {
  if (loading) return <p role="status">Loading wallet.</p>;
  if (!wallet) return <p role="status">Sign in to see your wallet.</p>;

  return (
    <section className="wallet" aria-label="Wallet" data-testid="wallet">
      <h2>Wallet</h2>
      <p data-testid="wallet-balance">Balance: {wallet.balance} coins</p>
      {wallet.bonus_balance > 0 && (
        <p data-testid="wallet-bonus">Bonus: {wallet.bonus_balance} coins</p>
      )}
      <h3>Unlocked</h3>
      {wallet.entitlements.length === 0 ? (
        <p>Nothing unlocked yet.</p>
      ) : (
        <ul data-testid="wallet-entitlements">
          {wallet.entitlements.map((e) => (
            <li key={`${e.scope}:${e.scope_id}`}>
              {e.scope}: {e.scope_id}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
