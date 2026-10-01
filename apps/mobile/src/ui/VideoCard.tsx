// Home row card (Netflix-like). One button per card whose label reads the whole card: title, channel,
// duration, accessibility features and sponsorship, so a screen reader user hears everything in one stop.
// No em dashes.

import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import type { Video } from "../core/api/types";
import { badgesFor, durationLabel, formatDuration } from "../core/a11y/tracks";
import { Badges } from "./Badges";
import { colors, space } from "./theme";

export function cardLabel(v: Video): string {
  const parts = [v.title, `by ${v.channel.name}`];
  const d = durationLabel(v.duration_ms);
  if (d) parts.push(d);
  for (const b of badgesFor(v.accessibility)) parts.push(b.label);
  if (v.sponsor) parts.push(`Sponsored by ${v.sponsor.brand}`);
  return parts.join(", ");
}

export function VideoCard({ video, onPress, width }: { video: Video; onPress(): void; width: number }) {
  const thumbAspect = video.orientation === "vertical" ? 9 / 16 : video.orientation === "square" ? 1 : 16 / 9;
  const height = Math.round(Math.min(width / thumbAspect, width * 1.5));
  const dur = formatDuration(video.duration_ms);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={cardLabel(video)}
      accessibilityHint="Opens the video"
      onPress={onPress}
      style={({ pressed }) => [styles.card, { width }, pressed && styles.pressed]}
    >
      <View style={[styles.thumb, { height }]}>
        {video.thumbnail_url ? (
          <Image source={{ uri: video.thumbnail_url }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
        ) : (
          <Text style={styles.placeholder} numberOfLines={3}>
            {video.title}
          </Text>
        )}
        {dur ? <Text style={styles.duration}>{dur}</Text> : null}
        {video.sponsor ? <Text style={styles.ad}>AD</Text> : null}
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {video.title}
      </Text>
      <Text style={styles.channel} numberOfLines={1}>
        {video.channel.name}
      </Text>
      <Badges a11y={video.accessibility} compact />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.xs },
  pressed: { opacity: 0.75 },
  thumb: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    padding: space.sm,
  },
  placeholder: { color: colors.textMuted, textAlign: "center", fontWeight: "600" },
  duration: { position: "absolute", right: 6, bottom: 6, color: colors.text, backgroundColor: colors.scrim, paddingHorizontal: 4, fontSize: 12 },
  ad: { position: "absolute", left: 6, top: 6, color: colors.sponsorText, backgroundColor: colors.sponsorBg, paddingHorizontal: 4, fontSize: 11, fontWeight: "800" },
  title: { color: colors.text, fontSize: 15, fontWeight: "600" },
  channel: { color: colors.textMuted, fontSize: 13 },
});
