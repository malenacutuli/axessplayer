// The paywall sheet, matching the prototype exactly: a gold lock tile, the heading "Unlock the
// alternate ending", a line of context, the rose primary CTA "Unlock for N coins" with a gold coin, a
// rewarded-ad ghost button, and a "Maybe later" ghost button. It renders exactly the options the
// server offered on a 402 (the contract PaywallOptions) and never invents a price: the price is
// server-derived and the unlock is settled by /spend. Labelled as a modal dialog, keyboard reachable.
// No em dashes.

import type { PaywallOptions } from "../api/economy.js";
import { LockIcon } from "../ui/icons.js";

export type PaywallChoice = "buy" | "watch_ad" | "subscribe" | "unlock";

export interface PaywallSheetProps {
  // The premium cut price (server-derived; the cost the spend ledger enforces).
  coinCost: number;
  // The viewer's current spendable balance, for the affordance.
  balance: number;
  // When set, the server already returned a 402 with these options. When undefined, this is the
  // pre-spend paywall at a premium beat: offer the direct unlock plus the standard rails.
  serverOptions?: PaywallOptions;
  onChoose: (choice: PaywallChoice) => void;
  onDismiss: () => void;
  busy?: boolean;
  error?: string | null;
}

const LABELS: Record<"buy" | "watch_ad" | "subscribe", string> = {
  buy: "Buy coins",
  watch_ad: "Watch a rewarded ad instead",
  subscribe: "Subscribe",
};

export function PaywallSheet({
  coinCost,
  balance,
  serverOptions,
  onChoose,
  onDismiss,
  busy,
  error,
}: PaywallSheetProps) {
  const canAfford = balance >= coinCost;
  const options: PaywallOptions["options"] = serverOptions?.options ?? [];

  return (
    <div
      className="sheet up"
      role="dialog"
      aria-modal="true"
      aria-label="Unlock premium content"
      data-testid="paywall"
    >
      <div className="paycard">
        <div className="lock" aria-hidden="true">
          <LockIcon stroke="var(--gold)" />
        </div>
        <h3>Unlock the alternate ending</h3>
        <div className="mut">See how Adrián's reveal really plays out. Premium cut.</div>
        <p className="muted" data-testid="paywall-balance" style={{ marginTop: 6 }}>
          Your balance: {balance} coins.
        </p>

        {serverOptions && (
          <p role="alert" className="err" data-testid="paywall-error">
            {serverOptions.error === "insufficient_funds"
              ? "You do not have enough coins."
              : serverOptions.error}
          </p>
        )}
        {error && !serverOptions && (
          <p role="alert" className="err" data-testid="paywall-spend-error">
            {error}
          </p>
        )}

        {/* Direct unlock only when there is no server 402 and the viewer can afford it. */}
        {!serverOptions && canAfford && (
          <button
            type="button"
            className="paybtn"
            onClick={() => onChoose("unlock")}
            disabled={busy}
            data-testid="paywall-unlock"
          >
            <span className="coin" aria-hidden="true" />
            Unlock for {coinCost} coins
          </button>
        )}

        {/* Server-offered options on a 402, in the order the server returned them. */}
        {options.map((opt) => (
          <button
            type="button"
            key={opt}
            className={opt === "buy" ? "paybtn" : "paybtn ghost"}
            onClick={() => onChoose(opt)}
            disabled={busy}
            aria-label={LABELS[opt]}
            data-testid={`paywall-${opt}`}
          >
            {opt === "buy" && <span className="coin" aria-hidden="true" />}
            {LABELS[opt]}
          </button>
        ))}

        {/* The rewarded-ad ghost is part of the prototype's default paywall (no 402 case). */}
        {!serverOptions && (
          <button
            type="button"
            className="paybtn ghost"
            onClick={() => onChoose("watch_ad")}
            disabled={busy}
            data-testid="paywall-watch_ad"
          >
            Watch a rewarded ad instead
          </button>
        )}

        <button
          type="button"
          className="paybtn ghost"
          onClick={onDismiss}
          disabled={busy}
          data-testid="paywall-dismiss"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
