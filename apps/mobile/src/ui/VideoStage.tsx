// Black stage that renders any aspect ratio letterboxed (contentFit "contain"), with a poster while the
// signed url resolves and clear states for unavailable / failed playback. No em dashes.

import { VideoView } from "expo-video";
import { useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";

import type { Video } from "../core/api/types";
import { aspectOf, fitContain } from "../core/player/letterbox";
import { Button } from "./Button";
import { colors, space } from "./theme";
import type { Playback } from "./useVideoPlayback";

export function VideoStage({ video, playback, nativeControls }: { video: Video; playback: Playback; nativeControls?: boolean }) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const rect = fitContain(box, aspectOf(video));
  const onLayout = (e: LayoutChangeEvent) => setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });

  return (
    <View style={styles.stage} onLayout={onLayout}>
      {video.thumbnail_url && playback.phase !== "ready" ? (
        <Image
          source={{ uri: video.thumbnail_url }}
          style={{ position: "absolute", left: rect.offsetX, top: rect.offsetY, width: rect.width, height: rect.height }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {playback.phase === "loading" || playback.phase === "ready" ? (
        <VideoView
          player={playback.player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls={nativeControls ?? false}
          fullscreenOptions={{ enable: !!nativeControls }}
          allowsPictureInPicture={!!nativeControls}
          accessibilityLabel={`Video: ${video.title}`}
        />
      ) : null}
      {playback.phase === "resolving" || playback.phase === "loading" ? (
        <ActivityIndicator style={styles.center} color={colors.text} size="large" accessibilityLabel="Loading video" />
      ) : null}
      {playback.phase === "unavailable" ? (
        <View style={styles.center} accessibilityLiveRegion="polite">
          <Text style={styles.msg}>This video is not available to play yet.</Text>
        </View>
      ) : null}
      {playback.phase === "error" ? (
        <View style={styles.center} accessibilityLiveRegion="polite">
          <Text style={styles.msg}>Playback failed.</Text>
          <Button label="Try again" onPress={playback.retry} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: colors.bg, overflow: "hidden" },
  center: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.lg },
  msg: { color: colors.text, fontSize: 16, textAlign: "center" },
});
