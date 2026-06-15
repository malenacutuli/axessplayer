// The paywall sheet (presentation). Reached at a premium beat: it presents the 402 PaywallOptions (buy /
// watch ad / subscribe) and, on the primary buy path, calls /spend through the wallet layer (no user_id,
// F1). The options shown come from the server's 402 body, reflected exactly. Optimistic UI then reconcile
// is handled by the caller via the wallet helpers. No em dashes.

import { useState, type FC } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ApiClient } from "../api/client.js";
import type { PaywallOption } from "../api/types.js";
import type { PaywallGate } from "../player/controller.js";
import { unlockGate } from "../player/controller.js";

export interface PaywallSheetProps {
  client: ApiClient;
  gate: PaywallGate;
  // Server-provided options from a prior 402, if known; defaults to the full set on first present.
  options?: readonly PaywallOption[];
  onUnlocked?: () => void;
}

const LABELS: Record<PaywallOption, string> = {
  buy: "Unlock with coins",
  watch_ad: "Watch an ad",
  subscribe: "Subscribe",
};

const ALL_OPTIONS: readonly PaywallOption[] = ["buy", "watch_ad", "subscribe"];

export const PaywallSheet: FC<PaywallSheetProps> = ({
  client,
  gate,
  options = ALL_OPTIONS,
  onUnlocked,
}) => {
  const [shown, setShown] = useState<readonly PaywallOption[]>(options);
  const [busy, setBusy] = useState(false);

  const onBuy = async () => {
    setBusy(true);
    const outcome = await unlockGate(client, gate);
    setBusy(false);
    if (outcome.kind === "unlocked") onUnlocked?.();
    // On a 402 the server returns a possibly-narrower option set; reflect it exactly.
    else if (outcome.kind === "paywall") setShown(outcome.options);
  };

  return (
    <View style={styles.sheet} accessibilityLabel="Unlock this scene" testID="paywall-sheet">
      <Text style={styles.title}>Unlock this scene</Text>
      <Text style={styles.cost}>{gate.estimatedCost} coins</Text>
      {shown.map((opt) => (
        <Pressable
          key={opt}
          accessibilityRole="button"
          accessibilityLabel={LABELS[opt]}
          disabled={busy}
          onPress={opt === "buy" ? onBuy : undefined}
          testID={`paywall-option-${opt}`}
          style={styles.option}
        >
          <Text style={styles.optionText}>{LABELS[opt]}</Text>
        </Pressable>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  sheet: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 24, backgroundColor: "#111" },
  title: { fontSize: 20, fontWeight: "700", color: "#fff" },
  cost: { fontSize: 16, color: "#9cf", marginTop: 4 },
  option: { paddingVertical: 14, marginTop: 8, backgroundColor: "#222", borderRadius: 8 },
  optionText: { fontSize: 16, color: "#fff", textAlign: "center" },
});
