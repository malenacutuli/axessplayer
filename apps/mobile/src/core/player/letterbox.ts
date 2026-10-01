// Letterbox math for any aspect ratio. The Watch screen and the Shorts feed render the video with
// contentFit "contain" inside a black stage; these helpers compute the exact on-screen rectangle so
// overlays (captions safe area, badges, the sponsor card) can sit against the picture rather than the
// bars. Pure and tested. No em dashes.

import type { Orientation } from "../api/types";

export interface Size {
  width: number;
  height: number;
}

export interface FitRect {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  // "letterbox" = bars top and bottom, "pillarbox" = bars left and right.
  bars: "none" | "letterbox" | "pillarbox";
}

const DEFAULT_ASPECT: Record<Orientation, number> = {
  vertical: 9 / 16,
  horizontal: 16 / 9,
  square: 1,
};

// width / height of the video. Prefers real dimensions, falls back to the declared orientation.
export function aspectOf(v: { orientation: Orientation; width: number | null; height: number | null }): number {
  if (v.width && v.height && v.width > 0 && v.height > 0) return v.width / v.height;
  return DEFAULT_ASPECT[v.orientation] ?? 16 / 9;
}

export function fitContain(container: Size, aspect: number): FitRect {
  const cw = Math.max(0, container.width);
  const ch = Math.max(0, container.height);
  if (cw === 0 || ch === 0 || !(aspect > 0)) {
    return { width: 0, height: 0, offsetX: 0, offsetY: 0, bars: "none" };
  }
  const containerAspect = cw / ch;
  const EPS = 0.005;
  if (Math.abs(containerAspect - aspect) / aspect < EPS) {
    return { width: cw, height: ch, offsetX: 0, offsetY: 0, bars: "none" };
  }
  if (aspect > containerAspect) {
    const height = cw / aspect;
    return { width: cw, height, offsetX: 0, offsetY: (ch - height) / 2, bars: "letterbox" };
  }
  const width = ch * aspect;
  return { width, height: ch, offsetX: (cw - width) / 2, offsetY: 0, bars: "pillarbox" };
}

// The inline (non-fullscreen) stage height on the Watch screen: a horizontal video gets a 16:9 band,
// a vertical one is capped so the info panel stays reachable, a square one gets a square stage.
export function inlineStageHeight(screen: Size, aspect: number, maxFraction = 0.7): number {
  const natural = screen.width / (aspect > 0 ? aspect : 16 / 9);
  return Math.min(natural, screen.height * maxFraction);
}
