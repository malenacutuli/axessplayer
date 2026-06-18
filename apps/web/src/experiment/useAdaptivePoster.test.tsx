// 25-D2 adaptive-poster hook tests. The hook starts at the fallback poster (no layout shift), swaps to
// the per-viewer selection when it resolves, logs an impression once when the poster intersects the
// viewport, and logs a click on activate. A null selection keeps the fallback (graceful, no dead end).
// No em dashes.

import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAdaptivePoster } from "./useAdaptivePoster.js";
import type { ExperimentClient, PosterSelection } from "../api/experiment.js";
import { DEFAULT_A11Y } from "../a11y/preferences.js";

// A controllable IntersectionObserver fake: capture the callback so the test can drive intersection.
function makeObserver() {
  const instances: Array<{ cb: IntersectionObserverCallback; el: Element | null }> = [];
  const Ctor = vi.fn(function (this: unknown, cb: IntersectionObserverCallback) {
    const inst = { cb, el: null as Element | null };
    instances.push(inst);
    return {
      observe(el: Element) {
        inst.el = el;
      },
      disconnect() {
        inst.el = null;
      },
      unobserve() {},
      takeRecords: () => [],
      root: null,
      rootMargin: "",
      thresholds: [],
    } as unknown as IntersectionObserver;
  }) as unknown as typeof IntersectionObserver;
  const fire = () => {
    for (const inst of instances) {
      if (inst.el) inst.cb([{ isIntersecting: true } as IntersectionObserverEntry], inst as unknown as IntersectionObserver);
    }
  };
  return { Ctor, fire, instances };
}

function stubExperiment(selection: PosterSelection | null) {
  return {
    selectPoster: vi.fn(async () => selection),
    logImpression: vi.fn(async () => {}),
    logClick: vi.fn(async () => {}),
  } satisfies ExperimentClient;
}

describe("useAdaptivePoster", () => {
  it("starts at the fallback and swaps to the per-viewer selection (no layout shift)", async () => {
    const exp = stubExperiment({ posterId: "p9", url: "http://cdn/p9.png", propensity: 0.5 });
    const { Ctor } = makeObserver();
    const { result } = renderHook(() =>
      useAdaptivePoster({ experiment: exp, seriesId: "s1", unit: "u1", fallbackUrl: "http://cdn/fallback.png", a11yPreferences: DEFAULT_A11Y, intersectionObserver: Ctor }),
    );
    // Synchronously, before selection resolves, the fallback paints.
    expect(result.current.posterUrl).toBe("http://cdn/fallback.png");
    await waitFor(() => expect(result.current.posterUrl).toBe("http://cdn/p9.png"));
    expect(result.current.posterId).toBe("p9");
  });

  it("logs the impression once when the poster intersects the viewport", async () => {
    const exp = stubExperiment({ posterId: "p9", url: "http://cdn/p9.png", propensity: 0.5 });
    const obs = makeObserver();
    const { result } = renderHook(() =>
      useAdaptivePoster({ experiment: exp, seriesId: "s1", unit: "u1", fallbackUrl: null, a11yPreferences: DEFAULT_A11Y, intersectionObserver: obs.Ctor }),
    );
    await waitFor(() => expect(result.current.posterId).toBe("p9"));
    // Attach the element so the observer starts watching.
    act(() => result.current.ref(document.createElement("div")));
    expect(exp.logImpression).not.toHaveBeenCalled();
    act(() => obs.fire());
    expect(exp.logImpression).toHaveBeenCalledOnce();
    expect(exp.logImpression).toHaveBeenCalledWith({ seriesId: "s1", posterId: "p9", unit: "u1", propensity: 0.5 });
    // Re-firing does not double-count.
    act(() => obs.fire());
    expect(exp.logImpression).toHaveBeenCalledOnce();
  });

  it("logs a click on activate", async () => {
    const exp = stubExperiment({ posterId: "p9", url: "http://cdn/p9.png", propensity: 0.5 });
    const { Ctor } = makeObserver();
    const { result } = renderHook(() =>
      useAdaptivePoster({ experiment: exp, seriesId: "s1", unit: "u1", fallbackUrl: null, a11yPreferences: DEFAULT_A11Y, intersectionObserver: Ctor }),
    );
    await waitFor(() => expect(result.current.posterId).toBe("p9"));
    act(() => result.current.onActivate());
    expect(exp.logClick).toHaveBeenCalledWith({ seriesId: "s1", posterId: "p9", unit: "u1", propensity: 0.5 });
  });

  it("keeps the fallback and logs nothing when selection is null (graceful)", async () => {
    const exp = stubExperiment(null);
    const obs = makeObserver();
    const { result } = renderHook(() =>
      useAdaptivePoster({ experiment: exp, seriesId: "s1", unit: "u1", fallbackUrl: "http://cdn/fallback.png", a11yPreferences: DEFAULT_A11Y, intersectionObserver: obs.Ctor }),
    );
    await waitFor(() => expect(exp.selectPoster).toHaveBeenCalled());
    expect(result.current.posterUrl).toBe("http://cdn/fallback.png");
    expect(result.current.posterId).toBeNull();
    act(() => result.current.ref(document.createElement("div")));
    act(() => obs.fire());
    expect(exp.logImpression).not.toHaveBeenCalled();
    act(() => result.current.onActivate());
    expect(exp.logClick).not.toHaveBeenCalled();
  });

  it("falls back to logging on mount when no IntersectionObserver is available", async () => {
    const exp = stubExperiment({ posterId: "p9", url: "http://cdn/p9.png" });
    const { result } = renderHook(() =>
      useAdaptivePoster({ experiment: exp, seriesId: "s1", unit: "u1", fallbackUrl: null, a11yPreferences: DEFAULT_A11Y, intersectionObserver: undefined as unknown as typeof IntersectionObserver }),
    );
    await waitFor(() => expect(result.current.posterId).toBe("p9"));
    act(() => result.current.ref(document.createElement("div")));
    await waitFor(() => expect(exp.logImpression).toHaveBeenCalledOnce());
  });
});
