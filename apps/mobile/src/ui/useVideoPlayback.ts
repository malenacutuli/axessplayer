// The playback hook shared by the Shorts feed and the Watch screen. It:
//  - resolves the short-lived signed HLS url (cache, refetch on expiry, refetch once or twice on a player
//    error, which is how a CDN 403 on an expired url surfaces in expo-video),
//  - creates the expo-video player, plays it only while `active`, otherwise keeps it paused (a preloaded
//    player buffers the start while paused),
//  - keeps captions ON by default: picks the best WebVTT subtitle track from the manifest for the viewer's
//    language and re-applies it when tracks arrive or the toggle changes,
//  - feeds the quartile tracker and sends viewership events (consent gated inside the events client).
// No em dashes.

import { useEvent, useEventListener } from "expo";
import { useVideoPlayer, type AudioTrack, type SubtitleTrack, type VideoPlayer } from "expo-video";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Video } from "../core/api/types";
import { pickSubtitleTrack, sameTrack } from "../core/a11y/tracks";
import { resolvePlaybackUrl, shouldRetryPlayback } from "../core/player/playbackUrl";
import { isLoopWrap, QuartileTracker, type TrackerEvent } from "../core/player/quartiles";
import { usePrefs } from "../state/PrefsProvider";
import { useServices } from "../state/ServicesProvider";

export type PlaybackPhase = "resolving" | "loading" | "ready" | "unavailable" | "error";

export interface PlaybackOptions {
  active: boolean;
  loop?: boolean;
  // When false the item is still resolved and buffered but never auto-started (reduce motion).
  autoplay?: boolean;
}

export interface Playback {
  player: VideoPlayer;
  phase: PlaybackPhase;
  playing: boolean;
  subtitleTracks: SubtitleTrack[];
  subtitleTrack: SubtitleTrack | null;
  audioTracks: AudioTrack[];
  audioTrack: AudioTrack | null;
  captionsEnabled: boolean;
  setCaptionsEnabled(on: boolean): void;
  selectSubtitle(track: SubtitleTrack | null): void;
  selectAudio(track: AudioTrack): void;
  togglePlay(): void;
  retry(): void;
}

function deviceLanguages(): string[] {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale;
    return loc ? [loc] : [];
  } catch {
    return [];
  }
}

export function useVideoPlayback(video: Video, opts: PlaybackOptions): Playback {
  const { content, events, playbackCache } = useServices();
  const { captionsEnabled, setCaptionsEnabled: persistCaptions } = usePrefs();
  const [url, setUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<PlaybackPhase>("resolving");
  const [intent, setIntent] = useState<"auto" | "play" | "pause">("auto");
  const attempts = useRef(0);
  const manualTrack = useRef<SubtitleTrack | null | undefined>(undefined);

  const fetchUrl = useCallback(
    async (id: string) => {
      const r = await content.getPlayback(id);
      if (r.ok) return r.data.playback_url;
      if (r.reason === "not_found" || r.reason === "forbidden") setPhase("unavailable");
      return null;
    },
    [content]
  );

  const load = useCallback(
    async (force: boolean) => {
      setPhase("resolving");
      const u = await resolvePlaybackUrl(playbackCache, video.id, fetchUrl, force);
      if (u) {
        setUrl(u);
        setPhase("loading");
      } else {
        setPhase((p) => (p === "unavailable" ? p : "error"));
      }
    },
    [playbackCache, video.id, fetchUrl]
  );

  useEffect(() => {
    attempts.current = 0;
    load(false);
  }, [load]);

  const source = useMemo(() => (url ? { uri: url, contentType: "hls" as const } : null), [url]);
  const player = useVideoPlayer(source, (p) => {
    p.loop = opts.loop ?? false;
    p.timeUpdateEventInterval = 0.5;
  });

  // Status: readiness, and error recovery with a fresh signed url.
  useEventListener(player, "statusChange", ({ status }) => {
    if (status === "readyToPlay") setPhase("ready");
    if (status === "error") {
      if (shouldRetryPlayback(attempts.current)) {
        attempts.current += 1;
        load(true);
      } else {
        setPhase("error");
      }
    }
  });

  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const { availableSubtitleTracks } = useEvent(player, "availableSubtitleTracksChange", {
    availableSubtitleTracks: player.availableSubtitleTracks,
  });
  const { subtitleTrack } = useEvent(player, "subtitleTrackChange", { subtitleTrack: player.subtitleTrack });
  const { availableAudioTracks } = useEvent(player, "availableAudioTracksChange", {
    availableAudioTracks: player.availableAudioTracks,
  });
  const { audioTrack } = useEvent(player, "audioTrackChange", { audioTrack: player.audioTrack });

  // Play only the active item. The viewer's explicit play / pause wins over autoplay; it resets when the
  // item leaves the screen.
  const wantsPlay = intent === "play" || (intent === "auto" && (opts.autoplay ?? true));
  const shouldPlay = opts.active && wantsPlay && phase === "ready";
  useEffect(() => {
    if (!opts.active) setIntent("auto");
  }, [opts.active]);
  useEffect(() => {
    try {
      if (shouldPlay) player.play();
      else player.pause();
    } catch {
      // player released during unmount
    }
  }, [shouldPlay, player]);

  // Captions: on by default, best track for the viewer's language unless the viewer picked one.
  useEffect(() => {
    try {
      const desired =
        manualTrack.current !== undefined && captionsEnabled
          ? manualTrack.current
          : pickSubtitleTrack(availableSubtitleTracks ?? [], captionsEnabled, deviceLanguages(), video.language);
      if (!sameTrack(player.subtitleTrack, desired)) player.subtitleTrack = desired ?? null;
    } catch {
      // player released
    }
  }, [availableSubtitleTracks, captionsEnabled, player, video.language]);

  // Viewership events: impression when the item becomes active, then play / quartiles / complete / seek.
  const tracker = useRef(new QuartileTracker());
  const lastPos = useRef<number | null>(null);
  const send = useCallback(
    (e: TrackerEvent) => {
      events.track({ type: e.type, video_id: video.id, position_ms: e.position_ms, value: "value" in e ? e.value : undefined });
    },
    [events, video.id]
  );
  useEffect(() => {
    if (opts.active) events.track({ type: "impression", video_id: video.id, position_ms: 0 });
  }, [opts.active, events, video.id]);

  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    if (!opts.active) return;
    const pos = currentTime * 1000;
    const dur = video.duration_ms ?? (player.duration > 0 ? player.duration * 1000 : null);
    if (isLoopWrap(lastPos.current, pos, dur)) {
      tracker.current.ended(lastPos.current ?? pos).forEach(send);
      tracker.current.reset();
    }
    lastPos.current = pos;
    if (!player.playing) return;
    tracker.current.update(pos, dur).forEach(send);
  });
  useEventListener(player, "playToEnd", () => {
    tracker.current.ended((player.duration || 0) * 1000).forEach(send);
    if (opts.loop) {
      tracker.current.reset();
      lastPos.current = null;
    }
  });

  const setCaptionsEnabled = useCallback(
    (on: boolean) => {
      manualTrack.current = undefined;
      persistCaptions(on);
      events.track({ type: "a11y_toggle", video_id: video.id, position_ms: player.currentTime * 1000, value: on ? "captions:on" : "captions:off" });
    },
    [persistCaptions, events, video.id, player]
  );

  const selectSubtitle = useCallback(
    (track: SubtitleTrack | null) => {
      manualTrack.current = track;
      if (track === null) {
        setCaptionsEnabled(false);
        return;
      }
      if (!captionsEnabled) persistCaptions(true);
      player.subtitleTrack = track;
      events.track({ type: "a11y_toggle", video_id: video.id, position_ms: player.currentTime * 1000, value: `captions:${track.language}` });
    },
    [player, captionsEnabled, persistCaptions, setCaptionsEnabled, events, video.id]
  );

  const selectAudio = useCallback(
    (track: AudioTrack) => {
      player.audioTrack = track;
      events.track({ type: "a11y_toggle", video_id: video.id, position_ms: player.currentTime * 1000, value: `audio:${track.language}` });
    },
    [player, events, video.id]
  );

  const togglePlay = useCallback(() => {
    setIntent(player.playing ? "pause" : "play");
  }, [player]);

  const retry = useCallback(() => {
    attempts.current = 0;
    load(true);
  }, [load]);

  return {
    player,
    phase,
    playing: isPlaying,
    subtitleTracks: availableSubtitleTracks ?? [],
    subtitleTrack: subtitleTrack ?? null,
    audioTracks: availableAudioTracks ?? [],
    audioTrack: audioTrack ?? null,
    captionsEnabled,
    setCaptionsEnabled,
    selectSubtitle,
    selectAudio,
    togglePlay,
    retry,
  };
}
