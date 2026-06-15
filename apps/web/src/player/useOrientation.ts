// Orientation hook for the player. Vertical (9:16) is the default; when the device is rotated to landscape
// the player goes full-bleed horizontal. Defensive: returns false (portrait) where matchMedia is absent
// (SSR, jsdom), so it never throws in tests. No em dashes.

import { useEffect, useState } from "react";

function readLandscape(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(orientation: landscape)").matches;
}

export function useIsLandscape(): boolean {
  const [landscape, setLandscape] = useState<boolean>(readLandscape);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(orientation: landscape)");
    const onChange = () => setLandscape(mq.matches);
    onChange();
    // addEventListener is the modern API; older Safari used addListener.
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    const legacy = mq as unknown as { addListener?: (cb: () => void) => void; removeListener?: (cb: () => void) => void };
    legacy.addListener?.(onChange);
    return () => legacy.removeListener?.(onChange);
  }, []);

  return landscape;
}

// Best-effort enter/exit a landscape fullscreen. Fullscreen + orientation lock only work on supporting
// devices (mobile) and from a user gesture; everywhere else this is a no-op and the CSS landscape class
// still does the visual rotation. Never throws.
export async function requestLandscape(el: Element | null): Promise<void> {
  try {
    await (el as unknown as { requestFullscreen?: () => Promise<void> })?.requestFullscreen?.();
  } catch {
    /* unsupported or denied; CSS still applies */
  }
  try {
    await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.("landscape");
  } catch {
    /* orientation lock not allowed on this device/browser */
  }
}

export async function exitLandscape(): Promise<void> {
  try {
    (screen.orientation as unknown as { unlock?: () => void })?.unlock?.();
  } catch {
    /* no-op */
  }
  try {
    if (typeof document !== "undefined" && document.fullscreenElement) await document.exitFullscreen?.();
  } catch {
    /* no-op */
  }
}
