// The paywall. Shown at a premium beat or when /spend returns 402. It renders exactly the options
// the server offered (the contract PaywallOptions: buy, watch_ad, subscribe) and never invents a
// price client-side: the price is server-derived and the unlock is settled by /spend. Each option is
// a keyboard-reachable button with an explicit aria-label. No em dashes.

import type { PaywallOptions } from "../api/economy.js";

export type PaywallChoice = "buy" | "watch_ad" | "subscribe" | "unlock";

export interface PaywallProps {
  // The premium variant's display info.
  title: string;
  coinCost: number;
  // The viewer's current spendable balance, for the buy / unlock affordance.
  balance: number;
  // When set, the server already returned a 402 with these options. When undefined, this is the
  // pre-spend paywall at a premium beat and we offer the direct unlock plus the standard options.
  serverOptions?: PaywallOptions;
  onChoose: (choice: PaywallChoice) => void;
  onDismiss: () => void;
  busy?: boolean;
}

const LABELS: Record<"buy" | "watch_ad" | "subscribe", string> = {
  buy: "Buy coins",
  watch_ad: "Watch an ad",
  subscribe: "Subscribe",
};

export function Paywall({
  title,
  coinCost,
  balance,
  serverOptions,
  onChoose,
  onDismiss,
  busy,
}: PaywallProps) {
  const canAfford = balance >= coinCost;
  const options = serverOptions?.options ?? ["buy", "watch_ad", "subscribe"];

  return (
    <div role="dialog" aria-modal="true" aria-label="Unlock premium content" className="paywall" data-testid="paywall">
      <h2>{title}</h2>
      <p>This is a premium cut. It costs {coinCost} coins.</p>
      <p data-testid="paywall-balance">Your balance: {balance} coins.</p>

      {serverOptions && (
        <p role="alert" data-testid="paywall-error">
          {serverOptions.error === "insufficient_funds"
            ? "You do not have enough coins."
            : serverOptions.error}
        </p>
      )}

      {/* Direct unlock only when there is no server 402 and the viewer can afford it. */}
      {!serverOptions && canAfford && (
        <button
          type="button"
          onClick={() => onChoose("unlock")}
          disabled={busy}
          data-testid="paywall-unlock"
        >
          Unlock for {coinCost} coins
        </button>
      )}

      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChoose(opt)}
          disabled={busy}
          aria-label={LABELS[opt]}
          data-testid={`paywall-${opt}`}
        >
          {LABELS[opt]}
        </button>
      ))}

      <button type="button" onClick={onDismiss} disabled={busy} data-testid="paywall-dismiss">
        Not now
      </button>
    </div>
  );
}
