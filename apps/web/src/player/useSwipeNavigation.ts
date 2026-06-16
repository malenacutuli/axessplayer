// Vertical swipe-feed navigation. An upward swipe (touch), a wheel-down (trackpad/mouse), or ArrowDown/Space
// advances to the next beat, the way a 9:16 feed pages. A single gesture fires once (cooldown), and the
// handler is inert while disabled (paywall open, a switch in flight, or the graph ended). Attaches to the
// given element. No em dashes.

import { useEffect, useRef } from "react";

export interface SwipeNavOptions {
  enabled: boolean;
  cooldownMs?: number;
  thresholdPx?: number;
}

export function useSwipeNavigation(
  el: HTMLElement | null,
  onNext: () => void,
  opts: SwipeNavOptions,
): void {
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;
  const enabledRef = useRef(opts.enabled);
  enabledRef.current = opts.enabled;
  const cooldown = opts.cooldownMs ?? 900;
  // A deliberate swipe/scroll, not an accidental trackpad nudge: a large touch distance and a high wheel
  // accumulation, so the player does not jump off a playing beat on a stray scroll.
  const threshold = opts.thresholdPx ?? 110;

  useEffect(() => {
    if (!el) return;
    let startY = 0;
    let lastFire = 0;
    let wheelAcc = 0;

    const fire = () => {
      const now = Date.now();
      if (!enabledRef.current || now - lastFire < cooldown) return;
      lastFire = now;
      onNextRef.current();
    };

    const onTouchStart = (e: TouchEvent) => {
      startY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const endY = e.changedTouches[0]?.clientY ?? startY;
      if (startY - endY > threshold) fire(); // upward swipe = next
    };
    const onWheel = (e: WheelEvent) => {
      // Require a large, sustained downward scroll, so an accidental trackpad nudge does not advance the beat.
      wheelAcc = e.deltaY > 0 ? wheelAcc + e.deltaY : 0;
      if (wheelAcc > 600) {
        wheelAcc = 0;
        fire();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        fire();
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("keydown", onKey);
    };
  }, [el, cooldown, threshold]);
}

// Warm the HTTP cache for upcoming HLS masters so the swipe switch has no buffering. Best-effort: a failed
// prefetch is ignored. Only fetches plain media URLs (an uploaded master.m3u8), never placeholders.
export function prefetchMedia(urls: Array<string | undefined>, fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)): void {
  for (const url of urls) {
    if (!url || !/\.m3u8(\?|$)/i.test(url)) continue;
    void fetchImpl(url, { method: "GET" }).catch(() => {});
  }
}
