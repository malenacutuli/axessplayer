// Tipping sheet (coins). Rendered only for signed-in viewers; guests never see a tip button. The server
// is authoritative for balances; this sheet shows the outcome, including "coming soon" while the
// economy endpoint is not deployed. No em dashes.

import { useRef, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";

import { TIP_PRESETS, type TipOutcome } from "../core/economy/tips";
import { useServices } from "../state/ServicesProvider";
import { Button } from "./Button";
import { colors, space, type } from "./theme";

const MESSAGES: Record<TipOutcome["status"], string> = {
  sent: "Thank you. Your tip was sent.",
  coming_soon: "Tipping is coming soon.",
  auth_required: "Please sign in again to tip.",
  insufficient_funds: "Not enough coins.",
  invalid: "Choose an amount.",
  error: "Something went wrong. Please try again.",
};

export function TipSheet({ videoId, channelName, visible, onClose }: { videoId: string; channelName: string; visible: boolean; onClose(): void }) {
  const { tips, events } = useServices();
  const [coins, setCoins] = useState<number>(TIP_PRESETS[0]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TipOutcome | null>(null);
  // One idempotency key per (amount) intent, reused on retry so a double tap cannot double-spend.
  const key = useRef<{ coins: number; key: string } | null>(null);

  async function send() {
    if (!key.current || key.current.coins !== coins) key.current = { coins, key: randomUUID() };
    setBusy(true);
    const r = await tips.sendTip(videoId, coins, key.current.key);
    setBusy(false);
    setResult(r);
    if (r.status === "sent") {
      key.current = null;
      events.track({ type: "tip_sent", video_id: videoId, value: coins });
    }
  }

  function close() {
    setResult(null);
    key.current = null;
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            Tip {channelName}
          </Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="Tip amount" style={styles.row}>
            {TIP_PRESETS.map((c) => (
              <Button key={c} role="radio" checked={coins === c} label={`${c} coins`} onPress={() => setCoins(c)} />
            ))}
          </View>
          {result ? (
            <Text style={styles.result} accessibilityLiveRegion="polite" accessibilityRole="alert">
              {MESSAGES[result.status]}
            </Text>
          ) : null}
          <View style={styles.row}>
            <Button variant="primary" label={busy ? "Sending" : `Send ${coins} coins`} disabled={busy} onPress={send} />
            <Button label="Close" onPress={close} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.scrim },
  sheet: { backgroundColor: colors.surface, padding: space.xl, gap: space.lg, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  title: { ...type.title, color: colors.text },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  result: { ...type.body, color: colors.text },
});
