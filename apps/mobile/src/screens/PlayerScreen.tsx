// The adaptive player screen (presentation). It runs a PlayerSession (player-sdk BranchingPlayer) and
// renders the current cut full-bleed with the accessibility tracks ON by default where the variant
// provides them. There is NO quality menu and NO visible adaptation: the seamless switch is invisible to
// the viewer. At a premium beat it surfaces the PaywallSheet.
//
// FLAG: the actual media surface (ExoPlayer/AVPlayer via Expo) and the frame-accurate cut-over are
// device work (W5 on hardware). Here the screen drives the decision/prefetch/switch orchestration and the
// a11y + paywall control flow; real playback seamlessness is integration-time verification. No em dashes.

import { useEffect, useState, type FC } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { ApiClient } from "../api/client.js";
import type { ActiveAccessibility } from "../accessibility/preferences.js";
import { PlayerSession, type NowPlaying } from "../player/controller.js";
import type { PaywallGate } from "../player/controller.js";
import { PaywallSheet } from "./PaywallSheet.js";

export interface PlayerScreenProps {
  client: ApiClient;
  session: PlayerSession;
  // The cold-open cut and its resolved a11y, from resolveBeatAccessibility on the episode's cold-open
  // beat. The screen renders this first, then advances the session as playback proceeds.
  initial: NowPlaying;
  // A premium gate to present, if the viewer reached one. Null while playing straight through.
  gate?: PaywallGate | null;
  onUnlocked?: () => void;
}

export const PlayerScreen: FC<PlayerScreenProps> = ({
  client,
  session,
  initial,
  gate,
  onUnlocked,
}) => {
  const [now, setNow] = useState<NowPlaying>(initial);

  // On mount, the host's playback callbacks would call session.recordSignals / advance. This effect is a
  // placeholder for that wiring; the orchestration itself is tested in src/player and the integration
  // test, not via this view.
  useEffect(() => {
    setNow(initial);
  }, [initial]);

  return (
    <View style={styles.stage} testID="player-stage">
      {/* The video surface lives here on device (Expo media). Logic-only in this lane. */}
      <View style={styles.video} accessibilityLabel="Now playing" />

      <AccessibilityTracks a11y={now.accessibility} />

      {gate ? (
        <PaywallSheet client={client} gate={gate} onUnlocked={onUnlocked} />
      ) : null}
    </View>
  );
};

// Renders the accessibility affordances that are ON for the current cut. Captions and sign are visual
// overlays; audio description is mixed into the audio track (no visual), shown here as a status for the
// a11y settings affordance. On by default where provided (resolved upstream).
const AccessibilityTracks: FC<{ a11y: ActiveAccessibility }> = ({ a11y }) => (
  <View style={styles.a11y} accessibilityLabel="Accessibility tracks">
    {a11y.captions ? <Text testID="captions-on">CC</Text> : null}
    {a11y.sign ? <Text testID="sign-on">Sign</Text> : null}
    {a11y.audioDescription ? <Text testID="ad-on">AD</Text> : null}
    {a11y.language ? <Text testID="language">{a11y.language}</Text> : null}
  </View>
);

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: "#000" },
  video: { flex: 1 },
  a11y: { position: "absolute", bottom: 16, left: 16, flexDirection: "row", gap: 8 },
});
