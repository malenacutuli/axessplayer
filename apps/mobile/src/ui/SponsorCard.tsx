// Sponsor disclosure card. Shown whenever a video has a sponsor, always visible (never behind a tap),
// labeled "Sponsored by <brand>" with the creator's disclosure text. FTC endorsement guides and EU
// AI Act Article 50 / DSA Article 26 style: the commercial nature is clear and announced first to screen
// readers. No em dashes.

import { StyleSheet, Text, View } from "react-native";

import type { Video } from "../core/api/types";
import { sponsorDisclosure } from "../core/a11y/tracks";
import { colors, space } from "./theme";

export function SponsorCard({ video, compact }: { video: Pick<Video, "sponsor">; compact?: boolean }) {
  const d = sponsorDisclosure(video);
  if (!d) return null;
  return (
    <View style={[styles.card, compact && styles.compact]} accessible accessibilityRole="text" accessibilityLabel={d.accessibilityLabel}>
      <Text style={styles.kicker}>AD</Text>
      <View style={styles.body}>
        <Text style={styles.heading}>{d.heading}</Text>
        {!compact ? <Text style={styles.text}>{d.body}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    backgroundColor: colors.sponsorBg,
    borderRadius: 8,
    padding: space.md,
  },
  compact: { padding: space.sm, alignSelf: "flex-start" },
  kicker: {
    color: colors.sponsorBg,
    backgroundColor: colors.sponsorText,
    fontWeight: "800",
    fontSize: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  body: { flexShrink: 1 },
  heading: { color: colors.sponsorText, fontWeight: "700", fontSize: 15 },
  text: { color: colors.sponsorText, fontSize: 14, marginTop: 2 },
});
