// One full-screen short. Autoplays only while it is the visible page (and reduce motion is off), keeps
// captions ON by default, and overlays title, channel, badges, the sponsor disclosure, and labeled
// actions (play / pause, captions, details, tip). Screen reader users get "next video" and "previous
// video" actions instead of having to swipe. No em dashes.

import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Video } from "../core/api/types";
import type { ItemRole } from "../core/feed/shorts";
import { useAuth } from "../state/AuthProvider";
import { Badges } from "./Badges";
import { Button } from "./Button";
import { SponsorCard } from "./SponsorCard";
import { colors, space } from "./theme";
import { TipSheet } from "./TipSheet";
import { useVideoPlayback } from "./useVideoPlayback";
import { VideoStage } from "./VideoStage";

export interface ShortsItemProps {
  video: Video;
  role: Exclude<ItemRole, "released">;
  height: number;
  focused: boolean;
  reduceMotion: boolean;
  onNext(): void;
  onPrevious(): void;
}

export function ShortsItem({ video, role, height, focused, reduceMotion, onNext, onPrevious }: ShortsItemProps) {
  const active = role === "active" && focused;
  const playback = useVideoPlayback(video, { active, loop: true, autoplay: !reduceMotion });
  const { session } = useAuth();
  const [tipOpen, setTipOpen] = useState(false);
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.page, { height }]}
      accessibilityActions={[
        { name: "next", label: "Next video" },
        { name: "previous", label: "Previous video" },
      ]}
      onAccessibilityAction={(e) => (e.nativeEvent.actionName === "next" ? onNext() : onPrevious())}
    >
      <VideoStage video={video} playback={playback} />

      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={playback.togglePlay}
        accessibilityRole="button"
        accessibilityLabel={playback.playing ? `Pause ${video.title}` : `Play ${video.title}`}
      />

      {!playback.playing && playback.phase === "ready" && role === "active" ? (
        <View style={styles.pausedHint} pointerEvents="none">
          <Text style={styles.pausedText}>{reduceMotion ? "Tap to play" : "Paused"}</Text>
        </View>
      ) : null}

      <View style={[styles.overlay, { paddingBottom: space.lg }]} pointerEvents="box-none">
        <View style={styles.meta} pointerEvents="box-none">
          <SponsorCard video={video} compact />
          <Text style={styles.title} numberOfLines={3} maxFontSizeMultiplier={1.8}>
            {video.title}
          </Text>
          <Text style={styles.channel} maxFontSizeMultiplier={1.8}>
            {video.channel.name}
          </Text>
          <Badges a11y={video.accessibility} compact />
        </View>
        <View style={[styles.actions, { paddingTop: insets.top }]} pointerEvents="box-none">
          <Button
            variant="ghost"
            role="switch"
            checked={playback.captionsEnabled}
            label={playback.captionsEnabled ? "Captions on" : "Captions off"}
            onPress={() => playback.setCaptionsEnabled(!playback.captionsEnabled)}
          >
            <Text style={styles.actionText}>CC</Text>
            <Text style={styles.actionSub}>{playback.captionsEnabled ? "On" : "Off"}</Text>
          </Button>
          <Button variant="ghost" label={`Details for ${video.title}`} onPress={() => router.push(`/watch/${encodeURIComponent(video.id)}`)}>
            <Text style={styles.actionText}>Info</Text>
          </Button>
          {session ? (
            <Button variant="ghost" label={`Tip ${video.channel.name}`} onPress={() => setTipOpen(true)}>
              <Text style={styles.actionText}>Tip</Text>
            </Button>
          ) : null}
        </View>
      </View>
      {session ? <TipSheet videoId={video.id} channelName={video.channel.name} visible={tipOpen} onClose={() => setTipOpen(false)} /> : null}
    </View>
  );
}

// A released page: just the title on black, no player allocated.
export function ShortsPlaceholder({ video, height }: { video: Video; height: number }) {
  return (
    <View style={[styles.page, styles.placeholder, { height }]}>
      <Text style={styles.title}>{video.title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: "100%", backgroundColor: colors.bg },
  placeholder: { alignItems: "center", justifyContent: "center", padding: space.xl },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "flex-end", padding: space.lg },
  meta: { flex: 1, gap: space.xs, paddingRight: space.md },
  title: { color: colors.text, fontSize: 17, fontWeight: "700", textShadowColor: "#000", textShadowRadius: 4 },
  channel: { color: colors.textMuted, fontSize: 14, textShadowColor: "#000", textShadowRadius: 4 },
  actions: { gap: space.md, alignItems: "center" },
  actionText: { color: colors.text, fontWeight: "800", fontSize: 14 },
  actionSub: { color: colors.textMuted, fontSize: 11 },
  pausedHint: { position: "absolute", alignSelf: "center", top: "45%", backgroundColor: colors.scrim, padding: space.md, borderRadius: 8 },
  pausedText: { color: colors.text, fontSize: 16, fontWeight: "700" },
});
