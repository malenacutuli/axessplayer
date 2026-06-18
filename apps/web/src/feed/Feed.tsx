// The "For you" feed, matching the prototype's Consumer feed: a light editorial header with a gold coins
// pill, then a column of story cards. Each card now renders a REAL published series from GET /feed (0009b):
// the generated poster (0009c) when present, else the prototype gradient. Tapping a card opens the live
// adaptive player for that series. Empty when nothing is published. Keyboard and listbox semantics keep the
// feed usable without a pointer. No em dashes.

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedItem } from "../api/content.js";

export interface FeedProps {
  // Published series from GET /feed (newest first).
  feed: FeedItem[];
  // Open a series in the player by id.
  onOpen: (seriesId: string) => void;
  // The live coin balance for the header pill (null while loading).
  coins: number | null;
  // Open the channels grid route (20-V2). Optional so the feed still renders in isolation.
  onOpenChannels?: () => void;
}

// A stable gradient per series id, so a series without a poster still gets a consistent card color.
const GRADIENTS = ["gp", "g4", "g3", "gcalm", "gtense"];
function gradientFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

export function Feed({ feed, onOpen, coins, onOpenChannels }: FeedProps) {
  const [index, setIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const clamp = useCallback((i: number) => Math.max(0, Math.min(feed.length - 1, i)), [feed.length]);
  const go = useCallback((delta: number) => setIndex((i) => clamp(i + delta)), [clamp]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || feed.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === "j") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "k") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onOpen(feed[index].id);
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [go, onOpen, feed, index]);

  return (
    <>
      <div className="feedhead">
        <span className="t">For you</span>
        <span className="feedhead__actions">
          {onOpenChannels && (
            <button type="button" className="feedhead__channels" onClick={onOpenChannels} data-testid="feed-channels-open">
              Channels
            </button>
          )}
          <span className="coins" data-testid="feed-coins" aria-label={`${coins ?? 0} coins`}>
            <span className="g" aria-hidden="true" />
            {coins ?? "…"}
          </span>
        </span>
      </div>

      {feed.length === 0 ? (
        <div className="frame-state" role="status" data-testid="feed-empty">
          Nothing published yet. Publish a series in the Studio to see it here.
        </div>
      ) : (
        <div
          ref={containerRef}
          className="feed"
          role="listbox"
          aria-label="Published series"
          aria-activedescendant={`feed-item-${feed[index]?.id}`}
          tabIndex={0}
          data-testid="feed"
        >
          {feed.map((item, i) => {
            const caption = capCase(item.genre ?? "") || "Series";
            return (
              <div
                key={item.id}
                id={`feed-item-${item.id}`}
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
                    onOpen(item.id);
                  }}
                  data-testid={`feed-open-${item.id}`}
                  aria-label={`${item.title}. ${caption}`}
                >
                  <div
                    className={`ph ${item.poster_url ? "" : gradientFor(item.id)}`}
                    style={
                      item.poster_url
                        ? { backgroundImage: `url(${item.poster_url})`, backgroundSize: "cover", backgroundPosition: "center" }
                        : undefined
                    }
                    data-testid={`feed-poster-${item.id}`}
                    data-poster-url={item.poster_url ?? ""}
                  >
                    <div className="badge">
                      <span className="dot" aria-hidden="true" />
                      Adapts to you
                    </div>
                    <div className="meta">
                      <div className="ti">{item.title}</div>
                    </div>
                  </div>
                  <div className="cap">
                    <span className="g">{caption}</span>
                    <span className="g">▶ live</span>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function capCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
