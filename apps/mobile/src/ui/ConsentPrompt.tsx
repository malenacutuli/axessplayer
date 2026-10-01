// First-launch analytics consent. Default OFF: nothing is sent unless the viewer taps Allow. Both choices
// have equal weight (no dark pattern) and the choice can be changed any time in Account. No em dashes.

import { Modal, StyleSheet, Text, View } from "react-native";

import { shouldPromptConsent } from "../core/consent/consent";
import { usePrefs } from "../state/PrefsProvider";
import { Button } from "./Button";
import { colors, space, type } from "./theme";

export function ConsentPrompt() {
  const { loaded, consent, setConsent } = usePrefs();
  const visible = loaded && shouldPromptConsent(consent);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setConsent("denied")}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            Help creators get paid fairly?
          </Text>
          <Text style={styles.body}>
            With your permission we record anonymous viewing events (plays, how far you watched, accessibility
            settings used) to pay creators and improve accessibility. No ads profile is built from this. It is off
            unless you allow it, and you can change it any time in Account.
          </Text>
          <View style={styles.row}>
            <Button label="Don't allow" onPress={() => setConsent("denied")} style={styles.flex} />
            <Button label="Allow" onPress={() => setConsent("granted")} style={styles.flex} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: space.xl, backgroundColor: colors.scrim },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: space.xl, gap: space.lg },
  title: { ...type.title, color: colors.text },
  body: { ...type.body, color: colors.textMuted },
  row: { flexDirection: "row", gap: space.md },
  flex: { flex: 1 },
});
