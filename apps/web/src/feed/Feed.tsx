// The vertical swipe feed. Episodes from the content graph stack vertically; the viewer swipes (or
// arrows / page keys) between them, the classic short-form feed gesture. Selecting an episode opens
// the adaptive player. Keyboard navigation and aria roles make the feed usable without a pointer
// (accessibility first). No em dashes.

import { useCallback, useEffect, useRef, useState } from "react";
import type { EpisodeNode, SeriesGraph } from "../api/content.js";

export interface FeedProps {
  graph: SeriesGraph;
  onOpen: (episode: EpisodeNode) => void;
}

export function Feed({ graph, onOpen }: FeedProps) {
  const episodes = [...graph.episodes].sort((a, b) => a.episode_number - b.episode_number);
  const [index, setIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const clamp = useCallback(
    (i: number) => Math.max(0, Math.min(episodes.length - 1, i)),
    [episodes.length],
  );

  const go = useCallback(
    (delta: number) => setIndex((i) => clamp(i + delta)),
    [clamp],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === "j") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "k") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onOpen(episodes[index]);
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [go, onOpen, episodes, index]);

  // Touch swipe: a vertical drag past the threshold advances the feed.
  const touchStartY = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0]?.clientY ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartY.current;
    if (start == null) return;
    const end = e.changedTouches[0]?.clientY ?? start;
    const dy = start - end;
    if (Math.abs(dy) > 40) go(dy > 0 ? 1 : -1);
    touchStartY.current = null;
  };

  if (episodes.length === 0) {
    return <p role="status">No episodes available.</p>;
  }

  const active = episodes[index];

  return (
    <div
      ref={containerRef}
      className="feed"
      role="listbox"
      aria-label={`${graph.series.title} episodes`}
      aria-activedescendant={`feed-item-${active.id}`}
      tabIndex={0}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      data-testid="feed"
    >
      {episodes.map((ep, i) => (
        <article
          key={ep.id}
          id={`feed-item-${ep.id}`}
          role="option"
          aria-selected={i === index}
          hidden={i !== index}
          className="feed-item"
          data-testid={`feed-item-${ep.id}`}
        >
          <h2>{ep.title}</h2>
          <p>
            Episode {ep.episode_number} of {graph.series.title}
          </p>
          <p className="feed-item-tag">
            {ep.is_free ? "Free" : `${ep.coin_cost} coins`}
          </p>
          <button type="button" onClick={() => onOpen(ep)} data-testid={`feed-open-${ep.id}`}>
            Watch
          </button>
        </article>
      ))}
      <nav className="feed-controls" aria-label="Feed navigation">
        <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous episode">
          Up
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={index === episodes.length - 1}
          aria-label="Next episode"
        >
          Down
        </button>
      </nav>
    </div>
  );
}
