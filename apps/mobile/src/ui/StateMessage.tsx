// Empty, unavailable and error states with an optional retry. Announced politely to screen readers.
// No em dashes.

import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Button } from "./Button";
import { colors, space, type } from "./theme";

export function StateMessage({ title, body, onRetry, loading }: { title: string; body?: string; onRetry?: () => void; loading?: boolean }) {
  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      {loading ? <ActivityIndicator color={colors.text} accessibilityLabel="Loading" /> : null}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {onRetry ? <Button label="Try again" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.md, backgroundColor: colors.bg },
  title: { ...type.title, color: colors.text, textAlign: "center" },
  body: { ...type.body, color: colors.textMuted, textAlign: "center" },
});
