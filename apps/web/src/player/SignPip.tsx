// Vertical-aware sign-language picture-in-picture for the 9:16 player.
//
// REUSE TARGET (per the accessibility directive, Section 3): the real ASL clips and the
// SynchronizedSignLanguagePlayer from the Axessible repo render INTO this slot once proposal 0009a wires a
// per-variant sign_video_url. Until that is ratified, this shows a labelled placeholder so the vertical layout
// is provable now (Work item A, ungated).
//
// Geometry is viewport-relative and defaults to a side and height that never overlap the caption safe area
// (bottom lower-third) or the right action rail (lower-right). The viewer can one-tap reposition (left/right)
// and toggle size. No em dashes.

import type { CSSProperties } from "react";

export type SignSide = "left" | "right";
export type SignSize = "small" | "large";

export interface SignPipProps {
  // Sign track on (from the a11y preferences / variant flag).
  active: boolean;
  // The real ASL clip URL. Gated behind 0009a; undefined today, so a placeholder renders in the slot.
  videoUrl?: string;
  side: SignSide;
  size: SignSize;
  onToggleSide: () => void;
  onToggleSize: () => void;
}

// Viewport-relative box widths (capped) so the PiP scales with the device but never dominates the 9:16 frame.
const SIZES: Record<SignSize, { width: string; maxWidth: number }> = {
  small: { width: "26vw", maxWidth: 150 },
  large: { width: "38vw", maxWidth: 220 },
};

export function SignPip({ active, videoUrl, side, size, onToggleSide, onToggleSize }: SignPipProps) {
  if (!active) return null;
  const dims = SIZES[size];
  // Sit ABOVE the caption safe area and the control bar (bottom ~28vh), inset from the frame edge. The right
  // action rail sits lower-right, so the default left side keeps the PiP clear of both captions and the rail.
  const box: CSSProperties = {
    position: "absolute",
    bottom: "30vh",
    left: side === "left" ? "4vw" : undefined,
    right: side === "right" ? "4vw" : undefined,
    width: dims.width,
    maxWidth: dims.maxWidth,
    aspectRatio: "3 / 4",
    borderRadius: 12,
    overflow: "hidden",
    zIndex: 6,
    background: "rgba(10,10,12,0.72)",
    border: "1px solid rgba(255,255,255,0.16)",
    boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
  };
  return (
    <div
      className="sign-pip"
      data-testid="track-sign"
      data-side={side}
      data-size={size}
      style={box}
      role="group"
      aria-label="Sign language"
    >
      {videoUrl ? (
        <video
          data-testid="sign-video"
          src={videoUrl}
          muted
          loop
          playsInline
          autoPlay
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <div
          data-testid="sign-placeholder"
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            color: "rgba(255,255,255,0.82)",
            fontSize: 12,
            padding: 8,
          }}
        >
          Sign language
        </div>
      )}
      <div
        className="sign-pip-controls"
        style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 6 }}
      >
        <button
          type="button"
          data-testid="sign-reposition"
          aria-label={side === "left" ? "Move sign language to the right" : "Move sign language to the left"}
          onClick={onToggleSide}
          style={pipBtn}
        >
          {side === "left" ? "→" : "←"}
        </button>
        <button
          type="button"
          data-testid="sign-size"
          aria-label={size === "small" ? "Enlarge sign language" : "Shrink sign language"}
          onClick={onToggleSize}
          style={pipBtn}
        >
          {size === "small" ? "+" : "−"}
        </button>
      </div>
    </div>
  );
}

const pipBtn: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(0,0,0,0.45)",
  color: "#fff",
  fontSize: 14,
  lineHeight: "1",
  cursor: "pointer",
};
