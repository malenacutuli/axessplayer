// The accessibility tray on the Watch screen: captions on/off switch, caption language choice from the
// WebVTT tracks in the HLS manifest, audio track choice (dubs and audio description renditions when the
// manifest carries them), and the badges for what this video offers. Every control is a labeled switch or
// radio with a 48 dp target. No em dashes.

import { StyleSheet, Text, View } from "react-native";

import type { Video } from "../core/api/types";
import { languageName, sameTrack } from "../core/a11y/tracks";
import { Badges } from "./Badges";
import { Button } from "./Button";
import { colors, space, type } from "./theme";
import type { Playback } from "./useVideoPlayback";

function trackName(t: { label: string; language: string }): string {
  return t.label || languageName(t.language);
}

export function A11yTray({ video, playback }: { video: Video; playback: Playback }) {
  const { captionsEnabled, subtitleTracks, subtitleTrack, audioTracks, audioTrack } = playback;
  const noCaptionTracks = subtitleTracks.length === 0;
  return (
    <View style={styles.tray} accessibilityLabel="Accessibility options">
      <Text style={styles.heading} accessibilityRole="header">
        Accessibility
      </Text>
      <Badges a11y={video.accessibility} />

      <View style={styles.row}>
        <Button
          role="switch"
          checked={captionsEnabled}
          label={captionsEnabled ? "Captions on" : "Captions off"}
          accessibilityHint="Turns captions on or off for all videos"
          onPress={() => playback.setCaptionsEnabled(!captionsEnabled)}
        />
      </View>
      {captionsEnabled && noCaptionTracks ? (
        <Text style={styles.note}>
          {video.accessibility.captions ? "Captions are loading." : "This video has no captions yet."}
        </Text>
      ) : null}
      {captionsEnabled && subtitleTracks.length > 1 ? (
        <View accessibilityRole="radiogroup" accessibilityLabel="Caption language" style={styles.group}>
          <Text style={styles.sub}>Caption language</Text>
          <View style={styles.wrap}>
            {subtitleTracks.map((t, i) => (
              <Button
                key={t.id ?? `${t.language}-${i}`}
                role="radio"
                checked={sameTrack(t, subtitleTrack)}
                label={trackName(t)}
                onPress={() => playback.selectSubtitle(t)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {audioTracks.length > 1 ? (
        <View accessibilityRole="radiogroup" accessibilityLabel="Audio track" style={styles.group}>
          <Text style={styles.sub}>Audio (dubs and audio description)</Text>
          <View style={styles.wrap}>
            {audioTracks.map((t, i) => (
              <Button
                key={t.id ?? `${t.language}-${i}`}
                role="radio"
                checked={sameTrack(t, audioTrack)}
                label={trackName(t)}
                onPress={() => playback.selectAudio(t)}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tray: { gap: space.md, padding: space.lg, backgroundColor: colors.surface, borderRadius: 12 },
  heading: { ...type.label, color: colors.text },
  row: { flexDirection: "row", gap: space.sm },
  group: { gap: space.sm },
  sub: { ...type.small, color: colors.textMuted },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  note: { ...type.small, color: colors.textMuted },
});
