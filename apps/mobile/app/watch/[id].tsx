// Watch: plays any aspect ratio (vertical, horizontal, square) letterboxed on a black stage with native
// controls (accessible, fullscreen, picture in picture), then the accessibility tray, title and channel,
// the sponsor disclosure, and the tip button for signed-in viewers. No em dashes.

import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import type { Video } from "../../src/core/api/types";
import { durationLabel, formatDuration } from "../../src/core/a11y/tracks";
import { aspectOf, inlineStageHeight } from "../../src/core/player/letterbox";
import { useAuth } from "../../src/state/AuthProvider";
import { useServices } from "../../src/state/ServicesProvider";
import { A11yTray } from "../../src/ui/A11yTray";
import { Button } from "../../src/ui/Button";
import { SponsorCard } from "../../src/ui/SponsorCard";
import { StateMessage } from "../../src/ui/StateMessage";
import { colors, space, type } from "../../src/ui/theme";
import { TipSheet } from "../../src/ui/TipSheet";
import { useVideoPlayback } from "../../src/ui/useVideoPlayback";
import { VideoStage } from "../../src/ui/VideoStage";

type Load = { status: "loading" } | { status: "ok"; video: Video } | { status: "missing" } | { status: "failed" };

export default function WatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { content } = useServices();
  const [state, setState] = useState<Load>({ status: "loading" });

  const load = useCallback(async () => {
    if (!id) return setState({ status: "missing" });
    setState({ status: "loading" });
    const r = await content.getVideo(String(id));
    if (r.ok) setState({ status: "ok", video: r.data });
    else setState({ status: r.reason === "not_found" || r.reason === "forbidden" ? "missing" : "failed" });
  }, [content, id]);

  useEffect(() => {
    load();
  }, [load]);

  if (state.status === "loading") return <StateMessage title="Loading" loading />;
  if (state.status === "missing") return <StateMessage title="Video not available" body="It may be unpublished or removed." />;
  if (state.status === "failed") return <StateMessage title="Could not load the video" body="Check your connection." onRetry={load} />;
  return <WatchBody video={state.video} />;
}

function WatchBody({ video }: { video: Video }) {
  const playback = useVideoPlayback(video, { active: true, loop: false, autoplay: true });
  const { session } = useAuth();
  const [tipOpen, setTipOpen] = useState(false);
  const screen = useWindowDimensions();
  const landscape = screen.width > screen.height;
  const stageHeight = landscape ? screen.height : inlineStageHeight(screen, aspectOf(video));
  const dur = formatDuration(video.duration_ms);

  return (
    <>
      <Stack.Screen options={{ title: video.title, headerShown: !landscape }} />
      <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: space.xl }}>
        <View style={{ height: stageHeight }}>
          <VideoStage video={video} playback={playback} nativeControls />
        </View>
        <View style={styles.body}>
          <SponsorCard video={video} />
          <Text style={styles.title} accessibilityRole="header">
            {video.title}
          </Text>
          <Text style={styles.meta} accessibilityLabel={[video.channel.name, durationLabel(video.duration_ms), video.category].filter(Boolean).join(", ")}>
            {[video.channel.name, dur, video.category].filter(Boolean).join("  |  ")}
          </Text>
          {session ? (
            <View style={styles.row}>
              <Button variant="primary" label={`Tip ${video.channel.name}`} onPress={() => setTipOpen(true)} />
            </View>
          ) : null}
          <A11yTray video={video} playback={playback} />
          {video.description ? <Text style={styles.description}>{video.description}</Text> : null}
        </View>
      </ScrollView>
      {session ? <TipSheet videoId={video.id} channelName={video.channel.name} visible={tipOpen} onClose={() => setTipOpen(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.lg, gap: space.lg },
  title: { ...type.title, color: colors.text },
  meta: { ...type.small, color: colors.textMuted },
  row: { flexDirection: "row", gap: space.sm },
  description: { ...type.body, color: colors.textMuted },
});
