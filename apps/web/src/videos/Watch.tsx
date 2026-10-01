// The watch page (YouTube-like): any aspect ratio letterboxed to fit, native controls, captions on by default,
// accessibility badges, sponsor disclosure, and creator channel. No em dashes.
import { useEffect, useState } from "react";
import { VideoSurface } from "./VideoSurface.js";
import { SponsorCard } from "./SponsorCard.js";
import { formatDuration, type Video, type VideosClient } from "./api.js";
import type { Milestone } from "./quartiles.js";

export interface WatchProps {
  videoId: string;
  client: VideosClient;
  onBack: () => void;
  onOpenChannel?: (id: string) => void;
  onEvent?: (name: Milestone | "play" | "video_opened" | "caption_toggled", video: Video) => void;
}

export function Watch({ videoId, client, onBack, onOpenChannel, onEvent }: WatchProps) {
  const [video, setVideo] = useState<Video | null>(null);
  const [missing, setMissing] = useState(false);
  const [captions, setCaptions] = useState(true);

  useEffect(() => {
    let live = true;
    setVideo(null);
    setMissing(false);
    client
      .get(videoId)
      .then((v) => {
        if (!live) return;
        setVideo(v);
        onEvent?.("video_opened", v);
      })
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, client]);

  if (missing) {
    return (
      <div className="watch" data-testid="watch">
        <button className="watch__back" onClick={onBack}>
          Back
        </button>
        <p role="alert">This video is not available.</p>
      </div>
    );
  }
  if (!video) return <div className="watch" role="status">Loading video</div>;

  const a11y = video.accessibility;
  return (
    <div className="watch" data-testid="watch">
      <button className="watch__back" onClick={onBack} aria-label="Back">
        Back
      </button>
      <div className="watch__stage">
        <VideoSurface video={video} client={client} active captions={captions} muted={false} controls onMilestone={(m) => onEvent?.(m, video)} />
      </div>
      <h1 className="watch__title">{video.title}</h1>
      <div className="watch__byline">
        <button className="watch__channel" onClick={() => onOpenChannel?.(video.channel.id)}>
          {video.channel.name}
        </button>
        <span>{formatDuration(video.duration_ms)}</span>
        <span>{video.views.toLocaleString()} views</span>
      </div>
      {video.sponsor && <SponsorCard sponsor={video.sponsor} />}
      <div className="watch__a11y" aria-label="Accessibility">
        <button
          className="chip"
          aria-pressed={captions}
          disabled={!a11y.captions}
          onClick={() => {
            setCaptions((c) => !c);
            onEvent?.("caption_toggled", video);
          }}
        >
          {a11y.captions ? (captions ? "Captions on" : "Captions off") : "Captions processing"}
        </button>
        {a11y.audio_description && <span className="chip">Audio description</span>}
        {a11y.sign && <span className="chip">Sign language</span>}
        {a11y.dubs.length > 0 && <span className="chip">Dubbed: {a11y.dubs.join(", ")}</span>}
      </div>
      {video.description && <p className="watch__desc">{video.description}</p>}
    </div>
  );
}
