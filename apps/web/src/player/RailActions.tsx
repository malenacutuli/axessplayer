// 20-V6 PLAYER EXTRAS: the lightweight rail actions: Like (an optimistic toggle with a count) and
// Share (the Web Share API with a clipboard fallback). These are intentionally NOT the community layer:
// Like is a single optimistic reaction with a displayed count read from the host, and Share is a deep
// link to the series. Both live in the player's right rail.
//
// Events: a like event on toggle ("post_liked", the canonical reaction event for the player rail), and
// "share" on a successful share / copy. WCAG 2.2 AA: real buttons with aria-pressed (Like) and aria-live
// feedback (Share copied). No em dashes.

import { useCallback, useState } from "react";
import { HeartIcon } from "../ui/icons.js";

export interface LikeButtonProps {
  // The starting like state + count for this series/beat, read from the host.
  initialLiked: boolean;
  initialCount: number;
  // Toggle handler. The host emits the like event and (when wired) persists the reaction. The button is
  // optimistic: it flips immediately and rolls back if the handler rejects.
  onToggle: (liked: boolean) => void | Promise<void>;
}

// Compact count formatter (1.2k, 12k) so the rail stays narrow. No locale dependency.
function fmtCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

export function LikeButton({ initialLiked, initialCount, onToggle }: LikeButtonProps) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);

  const toggle = useCallback(async () => {
    const next = !liked;
    // Optimistic flip.
    setLiked(next);
    setCount((c) => c + (next ? 1 : -1));
    try {
      await onToggle(next);
    } catch {
      // Roll back on failure so the count never drifts from the truth.
      setLiked(!next);
      setCount((c) => c + (next ? -1 : 1));
    }
  }, [liked, onToggle]);

  return (
    <button
      type="button"
      className={`rail rail--like${liked ? " is-liked" : ""}`}
      onClick={() => void toggle()}
      aria-pressed={liked}
      aria-label={liked ? `Liked, ${count} likes` : `Like, ${count} likes`}
      data-testid="player-like"
    >
      <span className="c">
        <HeartIcon />
      </span>
      <span data-testid="player-like-count">{fmtCount(count)}</span>
    </button>
  );
}

export interface ShareButtonProps {
  // What to share: a title and a deep-link url to the series.
  title: string;
  url: string;
  text?: string;
  // The host emits the "share" event with the method used.
  onShared: (method: "web_share" | "clipboard") => void;
}

export function ShareButton({ title, url, text, onShared }: ShareButtonProps) {
  // "copied" gives the clipboard-fallback an accessible confirmation; it clears after a moment.
  const [copied, setCopied] = useState(false);

  const share = useCallback(async () => {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    // Prefer the native share sheet when available (mobile).
    if (nav && typeof nav.share === "function") {
      try {
        await nav.share({ title, text: text ?? title, url });
        onShared("web_share");
        return;
      } catch (err) {
        // AbortError means the user dismissed the sheet: not a failure, do not fall back to copy.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Any other failure falls through to the clipboard copy.
      }
    }
    // Fallback: copy the deep link to the clipboard.
    try {
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(url);
      }
      setCopied(true);
      onShared("clipboard");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Last resort: still emit so the intent is captured even if the clipboard is blocked.
      onShared("clipboard");
    }
  }, [title, text, url, onShared]);

  return (
    <button
      type="button"
      className="rail rail--share"
      onClick={() => void share()}
      aria-label={copied ? "Link copied" : "Share"}
      data-testid="player-share"
    >
      <span className="c">
        <ShareGlyph />
      </span>
      <span aria-live="polite" data-testid="player-share-label">
        {copied ? "Copied" : "Share"}
      </span>
    </button>
  );
}

function ShareGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 3v13M8 7l4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
