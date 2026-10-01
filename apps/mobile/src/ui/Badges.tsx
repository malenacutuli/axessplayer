// Accessibility badges (CC, AD, Sign, Dubs). Each badge is a labeled text element so screen readers
// announce "Captions available", not "C C". No em dashes.

import { StyleSheet, Text, View } from "react-native";

import type { VideoAccessibility } from "../core/api/types";
import { badgesFor } from "../core/a11y/tracks";
import { colors, space } from "./theme";

export function Badges({ a11y, compact }: { a11y: VideoAccessibility; compact?: boolean }) {
  const badges = badgesFor(a11y);
  if (badges.length === 0) return null;
  return (
    <View style={styles.row} accessibilityRole="list" accessibilityLabel="Accessibility features">
      {badges.map((b) => (
        <View key={b.key} style={[styles.badge, compact && styles.compact]} accessible accessibilityLabel={b.label}>
          <Text style={styles.text} maxFontSizeMultiplier={2}>
            {b.short}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  badge: {
    borderWidth: 1,
    borderColor: colors.text,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: colors.scrim,
  },
  compact: { paddingHorizontal: 4, paddingVertical: 1 },
  text: { color: colors.text, fontSize: 12, fontWeight: "700" },
});
