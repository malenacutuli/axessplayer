// The shorts feed (TikTok-like): full-height vertical pages with scroll snap. The page in view plays (muted
// until the viewer taps sound on), others pause; captions are on by default; the next page loads before the
// viewer reaches the end. Keyboard: ArrowUp/ArrowDown move between shorts. No em dashes.
import { useCallback, useEffect, useRef, useState } from "react";
import { VideoSurface } from "./VideoSurface.js";
import { SponsorCard } from "./SponsorCard.js";
import type { Video, VideosClient } from "./api.js";
import type { Milestone } from "./quartiles.js";

export interface ShortsProps {
  client: VideosClient;
  onOpenVideo: (id: string) => void;
  onEvent?: (name: Milestone | "play" | "impression" | "caption_toggled", video: Video) => void;
}

export function Shorts({ client, onOpenVideo, onEvent }: ShortsProps) {
  const [items, setItems] = useState<Video[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const loading = useRef(false);
  const list = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    if (loading.current || cursor === null) return;
    loading.current = true;
    try {
      const page = await client.shorts(cursor ?? null);
      setItems((prev) => [...prev, ...page.items.filter((v) => !prev.some((p) => p.id === v.id))]);
      setCursor(page.next_cursor);
      setState("ready");
    } catch {
      setState((s) => (s === "loading" ? "error" : s));
    } finally {
      loading.current = false;
    }
  }, [client, cursor]);

  useEffect(() => {
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The page that is mostly in view is the active one.
  useEffect(() => {
    const root = list.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) setActive(Number((e.target as HTMLElement).dataset.index));
        }
      },
      { root, threshold: [0.6] },
    );
    root.querySelectorAll("[data-index]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items.length]);

  useEffect(() => {
    const v = items[active];
    if (v) onEvent?.("impression", v);
    if (items.length - active <= 3) void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const go = (delta: number) => {
    const next = Math.max(0, Math.min(items.length - 1, active + delta));
    list.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ behavior: "smooth" });
  };

  if (state === "loading") return <div className="shorts__msg" role="status">Loading shorts</div>;
  if (state === "error") return <div className="shorts__msg" role="alert">Shorts could not load. Pull to retry later.</div>;
  if (items.length === 0) return <div className="shorts__msg" role="status">No shorts yet. Creators are uploading.</div>;

  return (
    <div
      className="shorts"
      ref={list}
      tabIndex={0}
      aria-label="Shorts. Use the up and down arrow keys to move between videos."
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          go(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          go(-1);
        }
      }}
      data-testid="shorts"
    >
      {items.map((v, i) => (
        <section className="shorts__page" key={v.id} data-index={i} aria-roledescription="short" aria-label={`${v.title} by ${v.channel.name}`}>
          <VideoSurface
            video={v}
            client={client}
            active={i === active}
            captions={captions}
            muted={muted}
            loop
            fill
            onMilestone={(m) => onEvent?.(m, v)}
          />
          <div className="shorts__meta">
            <button className="shorts__title" onClick={() => onOpenVideo(v.id)}>
              {v.title}
            </button>
            <span className="shorts__channel">{v.channel.name}</span>
            {v.sponsor && <SponsorCard sponsor={v.sponsor} compact />}
          </div>
          <div className="shorts__rail">
            <button className="shorts__btn" aria-pressed={!muted} aria-label={muted ? "Turn sound on" : "Mute"} onClick={() => setMuted((m) => !m)}>
              {muted ? "Sound" : "Mute"}
            </button>
            <button
              className="shorts__btn"
              aria-pressed={captions}
              aria-label={captions ? "Hide captions" : "Show captions"}
              onClick={() => {
                setCaptions((c) => !c);
                onEvent?.("caption_toggled", v);
              }}
            >
              CC
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
