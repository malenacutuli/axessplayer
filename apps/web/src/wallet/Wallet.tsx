// The wallet screen, matching the prototype exactly: an ink balance card with the gold coin number,
// a "Buy coins" section (rose primary on the most-popular pack, ghost on the rest), an "Earn free
// coins" section (rewarded ad / daily check-in), and an "Unlocked" section listing the viewer's
// entitlements. The balance is read from the server, never computed client-side as truth (golden rule
// 5). Buy / earn rails are server-to-server (/grant) and flagged as integration-time. No em dashes.

import type { Wallet as WalletData } from "../api/economy.js";

export interface WalletScreenProps {
  wallet: WalletData | null;
  loading?: boolean;
}

export function WalletScreen({ wallet, loading }: WalletScreenProps) {
  return (
    <div className="pad" data-testid="wallet">
      <div className="bal">
        <div className="eyw">Balance</div>
        <div className="n">
          <b data-testid="wallet-balance">{loading || !wallet ? "…" : wallet.balance}</b> coins
        </div>
      </div>

      <div className="scaption">Buy coins</div>
      <div className="row">
        <div className="ic"><span className="gcoin" /></div>
        <div style={{ flex: 1 }}>
          <div>50 coins</div>
          <div className="muted">Most popular</div>
        </div>
        <button type="button" className="pricebtn pri" disabled aria-label="Buy 50 coins for $4.99">
          $4.99
        </button>
      </div>
      <div className="row">
        <div className="ic"><span className="gcoin" /></div>
        <div style={{ flex: 1 }}>
          <div>120 coins</div>
          <div className="muted">+20 bonus</div>
        </div>
        <button type="button" className="pricebtn" disabled aria-label="Buy 120 coins for $9.99">
          $9.99
        </button>
      </div>

      <div className="scaption">Earn free coins</div>
      <div className="row">
        <div className="ic" aria-hidden="true">▶</div>
        <div style={{ flex: 1 }}>
          Watch a rewarded ad <span className="muted">+2</span>
        </div>
      </div>
      <div className="row">
        <div className="ic" aria-hidden="true">✓</div>
        <div style={{ flex: 1 }}>
          Daily check-in <span className="muted">+1</span>
        </div>
      </div>

      <div className="scaption">Unlocked</div>
      {!wallet || wallet.entitlements.length === 0 ? (
        <div className="muted" data-testid="wallet-empty">Nothing unlocked yet.</div>
      ) : (
        <div data-testid="wallet-entitlements">
          {wallet.entitlements.map((e) => (
            <div className="row" key={`${e.scope}:${e.scope_id}`}>
              <div className="ic" aria-hidden="true">◆</div>
              <div style={{ flex: 1 }}>
                {labelFor(e.scope)} <span className="muted">{shortId(e.scope_id)}</span>
              </div>
              <span className="owned">OWNED</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function labelFor(scope: string): string {
  return scope === "beat_variant" ? "The Last Signal · Alt ending" : scope;
}

function shortId(id: string): string {
  return id.length > 8 ? `…${id.slice(-6)}` : id;
}
