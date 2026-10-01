// Netflix-style rows of videos for the home screen: horizontally scrolling tiles sized to each video's shape
// (vertical shorts are tall, long-form is wide), with duration and accessibility badges. No em dashes.
import { useEffect, useState } from "react";
import { formatDuration, type HomeRow, type Video, type VideosClient } from "./api.js";

export function VideoRows({ client, onOpenVideo, onOpenShorts }: { client: VideosClient; onOpenVideo: (id: string) => void; onOpenShorts: () => void }) {
  const [rows, setRows] = useState<HomeRow[] | null>(null);
  useEffect(() => {
    let live = true;
    client
      .home()
      .then((r) => live && setRows(r.rows))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [client]);
  if (!rows || rows.length === 0) return null;
  return (
    <div className="vrows" data-testid="video-rows">
      {rows.map((row) => (
        <section key={row.id} className="vrow" aria-labelledby={`vrow-${row.id}`}>
          <div className="vrow__head">
            <h2 id={`vrow-${row.id}`}>{row.title}</h2>
            {row.id === "shorts" && (
              <button className="vrow__more" onClick={onOpenShorts}>
                Open shorts
              </button>
            )}
          </div>
          <div className="vrow__items" role="list">
            {row.items.map((v) => (
              <Tile key={v.id} v={v} onOpen={() => (v.format === "short" && row.id === "shorts" ? onOpenShorts() : onOpenVideo(v.id))} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Tile({ v, onOpen }: { v: Video; onOpen: () => void }) {
  const tall = v.orientation === "vertical";
  const badges = [v.accessibility.captions && "CC", v.accessibility.audio_description && "AD", v.accessibility.sign && "Sign"].filter(Boolean);
  return (
    <button role="listitem" className={`vtile${tall ? " vtile--tall" : ""}`} onClick={onOpen} aria-label={`${v.title}, ${v.channel.name}, ${formatDuration(v.duration_ms)}`}>
      <span className="vtile__thumb" style={{ backgroundImage: v.thumbnail_url ? `url(${v.thumbnail_url})` : undefined }}>
        <span className="vtile__dur">{formatDuration(v.duration_ms)}</span>
        {badges.length > 0 && <span className="vtile__a11y">{badges.join(" ")}</span>}
      </span>
      <span className="vtile__title">{v.title}</span>
      <span className="vtile__channel">{v.channel.name}</span>
    </button>
  );
}
