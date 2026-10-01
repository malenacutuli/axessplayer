// One playing video of any aspect ratio. Fetches its signed HLS URL, attaches hls.js (or native HLS), shows
// captions by default (Stream embeds the WebVTT track in the manifest), reports viewership milestones, and
// never autoplays for viewers who prefer reduced motion. No em dashes.
import { useEffect, useRef, useState } from "react";
import { attachHls } from "../player/hls.js";
import { aspectOf, type Video, type VideosClient } from "./api.js";
import { createQuartileTracker, type Milestone } from "./quartiles.js";

export interface VideoSurfaceProps {
  video: Video;
  client: Pick<VideosClient, "playback">;
  active: boolean;
  captions: boolean;
  muted: boolean;
  controls?: boolean;
  loop?: boolean;
  fill?: boolean;
  onMilestone?: (m: Milestone | "play") => void;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function VideoSurface({ video, client, active, captions, muted, controls = false, loop = false, fill = false, onMilestone }: VideoSurfaceProps) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || url) return;
    let live = true;
    client
      .playback(video.id)
      .then((r) => live && setUrl(r.playback_url))
      .catch(() => live && setError("This video is not available right now."));
    return () => {
      live = false;
    };
  }, [active, url, video.id, client]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !url || !active) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void attachHls(el, url).then((c) => {
      if (cancelled) c();
      else cleanup = c;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [url, active]);

  // Captions: show the first subtitles/captions text track whenever one appears (and on toggle).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      let shown = false;
      for (const t of Array.from(el.textTracks)) {
        if (t.kind !== "subtitles" && t.kind !== "captions") continue;
        t.mode = captions && !shown ? "showing" : "disabled";
        if (captions && !shown) shown = true;
      }
    };
    apply();
    el.textTracks.addEventListener?.("addtrack", apply);
    return () => el.textTracks.removeEventListener?.("addtrack", apply);
  }, [captions, url]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (active && url && !prefersReducedMotion()) {
      // play() returns a promise in modern browsers but undefined in some older ones: never assume it.
      const p = el.play() as Promise<void> | undefined;
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
    if (!active) el.pause();
  }, [active, url]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !onMilestone) return;
    const tracker = createQuartileTracker((m) => onMilestone(m));
    let played = false;
    const onTime = () => tracker.update(el.currentTime, el.duration);
    const onPlay = () => {
      if (!played) {
        played = true;
        onMilestone("play");
      }
    };
    const onEnded = () => tracker.ended();
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("ended", onEnded);
    };
  }, [onMilestone, url]);

  return (
    <div className={`vsurface${fill ? " vsurface--fill" : ""}`} style={{ aspectRatio: fill ? undefined : aspectOf(video) }} data-orientation={video.orientation ?? "unknown"}>
      {video.thumbnail_url && !url && <img className="vsurface__poster" src={video.thumbnail_url} alt="" />}
      <video
        ref={ref}
        className="vsurface__video"
        playsInline
        muted={muted}
        loop={loop}
        controls={controls}
        crossOrigin="anonymous"
        aria-label={video.title}
        poster={video.thumbnail_url ?? undefined}
        data-testid={`vsurface-${video.id}`}
      />
      {error && (
        <p className="vsurface__error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
