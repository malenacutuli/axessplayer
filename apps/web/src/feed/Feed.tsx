// The "For you" feed, matching the prototype's Consumer feed exactly: a light editorial header with a
// gold coins pill, then a column of story cards. Each card is a gradient poster (the prototype's .gp /
// .g4 / .g3, no external assets) with an "Adapts to you" rose-dot badge, a title overlay, and a
// genre/episode/views caption.
//
// The FIRST card is the REAL seeded series ("The Last Signal") and opens the live adaptive player. The
// other two cards are the prototype's styled placeholders (not yet seeded), shown to match the design;
// they are not clickable into a player. Keyboard and listbox semantics keep the feed usable without a
// pointer. No em dashes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SeriesGraph } from "../api/content.js";

export interface FeedProps {
  graph: SeriesGraph;
  // Open the real series in the player.
  onOpen: () => void;
  // The live coin balance for the header pill (null while loading).
  coins: number | null;
}

// One feed card. The first is real (the live series); the rest are prototype placeholders.
interface FeedCard {
  id: string;
  title: string;
  poster: string; // gradient class
  caption: string;
  views?: string;
  real: boolean;
}

export function Feed({ graph, onOpen, coins }: FeedProps) {
  const cards: FeedCard[] = useMemo(() => {
    const firstEpisode = [...graph.episodes].sort((a, b) => a.episode_number - b.episode_number)[0];
    const beatCount = graph.beats.length;
    return [
      {
        id: graph.series.id,
        title: graph.series.title,
        poster: "gp",
        caption:
          capCase(graph.series.genre) +
          (firstEpisode ? ` · Ep ${firstEpisode.episode_number}` : "") +
          ` · ${beatCount} ch`,
        views: "▶ 1.2M",
        real: true,
      },
      {
        id: "placeholder-burn",
        title: "Five Years to Burn It Down",
        poster: "g4",
        caption: "Revenge · New",
        real: false,
      },
      {
        id: "placeholder-alpha",
        title: "Rejected by the Alpha",
        poster: "g3",
        caption: "Fantasy romance",
        real: false,
      },
    ];
  }, [graph]);

  const [index, setIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const clamp = useCallback(
    (i: number) => Math.max(0, Math.min(cards.length - 1, i)),
    [cards.length],
  );
  const go = useCallback((delta: number) => setIndex((i) => clamp(i + delta)), [clamp]);

  const openIfReal = useCallback(
    (card: FeedCard) => {
      if (card.real) onOpen();
    },
    [onOpen],
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
        openIfReal(cards[index]);
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [go, openIfReal, cards, index]);

  return (
    <>
      <div className="feedhead">
        <span className="t">For you</span>
        <span className="coins" data-testid="feed-coins" aria-label={`${coins ?? 0} coins`}>
          <span className="g" aria-hidden="true" />
          {coins ?? "…"}
        </span>
      </div>

      <div
        ref={containerRef}
        className="feed"
        role="listbox"
        aria-label={`${graph.series.title} and more`}
        aria-activedescendant={`feed-item-${cards[index].id}`}
        tabIndex={0}
        data-testid="feed"
      >
        {cards.map((card, i) => (
          <div
            key={card.id}
            id={`feed-item-${card.id}`}
            role="option"
            aria-selected={i === index}
            className="card"
            onMouseEnter={() => setIndex(i)}
          >
            <button
              type="button"
              className="card"
              onClick={() => {
                setIndex(i);
                openIfReal(card);
              }}
              data-testid={`feed-open-${card.id}`}
              aria-label={`${card.title}. ${card.caption}${card.real ? "" : " (coming soon)"}`}
            >
              <div className={`ph ${card.poster}`}>
                <div className="badge">
                  <span className="dot" aria-hidden="true" />
                  {card.real ? "Adapts to you" : "Adaptive"}
                </div>
                <div className="meta">
                  <div className="ti">{card.title}</div>
                </div>
              </div>
              <div className="cap">
                <span className="g">{card.caption}</span>
                {card.views && <span className="g">{card.views}</span>}
              </div>
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function capCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
