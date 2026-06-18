// 25-D2 viewer-side poster hook. For a series poster on the feed / continue / trending rails and series
// detail, this hook requests the per-viewer poster from the experiment service, falls back to the
// existing series poster when the service is unreachable or the set is empty, logs an impression when the
// poster scrolls into view (IntersectionObserver), and exposes an activate handler that logs a click.
//
// Guarantees:
// - NO layout shift: the hook never changes which element renders; it only swaps the poster URL. While the
//   selection is in flight, the fallback URL is used, so the same surface paints immediately.
// - NO dead end: a null selection resolves to the fallback URL; logging is best-effort and never blocks.
// - The ACCESSIBILITY-FIRST variant is honored when the viewer has a relevant accessibility preference set
//   (see resolvePosterSelection); otherwise the bandit selection stands.
// - Identity is the session/viewer unit passed through; never a user id in a body (the client enforces F1).
// No em dashes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExperimentClient, PosterSelection } from "../api/experiment.js";
import { loadA11yPreferences, type A11yPreferences } from "../a11y/preferences.js";
import { resolvePosterSelection } from "./posterSelection.js";

export interface UseAdaptivePosterOptions {
  experiment: ExperimentClient;
  // The series whose poster SET we select from.
  seriesId: string;
  // The session or viewer unit the selection is served to (and logged against).
  unit: string;
  // The existing series.poster_url to fall back to (graceful, no layout shift). May be null.
  fallbackUrl: string | null;
  // Viewer accessibility preferences. Defaults to the persisted device preferences (accessibility-first).
  a11yPreferences?: A11yPreferences;
  // Injectable for tests; the IntersectionObserver constructor. Defaults to the global one when present.
  intersectionObserver?: typeof IntersectionObserver;
}

export interface AdaptivePoster<E extends Element = HTMLElement> {
  // Attach to the poster element so the impression fires when it scrolls into view.
  ref: (node: E | null) => void;
  // The poster URL to render: the per-viewer selection when resolved, else the fallback. Never undefined
  // mid-flight (starts at the fallback), so there is no layout shift.
  posterUrl: string | null;
  // The posterId being served (the selection's id, or null while only the fallback is showing).
  posterId: string | null;
  // Call on tap/click to log a poster click (best-effort). Safe to call when only the fallback shows.
  onActivate: () => void;
}

const noopObserver = typeof IntersectionObserver !== "undefined" ? IntersectionObserver : undefined;

export function useAdaptivePoster<E extends Element = HTMLElement>(
  opts: UseAdaptivePosterOptions,
): AdaptivePoster<E> {
  const { experiment, seriesId, unit, fallbackUrl } = opts;

  // Resolve the a11y preferences once. Reading persisted device prefs is cheap and safe in tests (it
  // returns the accessibility-first defaults when storage is unavailable).
  const prefs = useMemo<A11yPreferences>(
    () => opts.a11yPreferences ?? loadA11yPreferences(),
    [opts.a11yPreferences],
  );

  const [selection, setSelection] = useState<PosterSelection | null>(null);
  const impressionLogged = useRef(false);
  const elementRef = useRef<E | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Request the per-viewer poster. A failure or empty set leaves selection null -> the fallback stands.
  useEffect(() => {
    let live = true;
    impressionLogged.current = false;
    setSelection(null);
    void (async () => {
      const sel = await experiment.selectPoster(seriesId, unit);
      if (live) setSelection(sel);
    })();
    return () => {
      live = false;
    };
  }, [experiment, seriesId, unit]);

  const resolved = useMemo(() => resolvePosterSelection(selection, prefs), [selection, prefs]);

  const posterUrl = resolved && resolved.url !== null ? resolved.url : fallbackUrl;
  const posterId = resolved ? resolved.posterId : null;

  // Fire the impression once, when the poster is on screen AND a real selection has resolved (we log the
  // served posterId, so we wait for the selection before counting an impression). Best-effort.
  const maybeLogImpression = useCallback(() => {
    if (impressionLogged.current || !resolved) return;
    impressionLogged.current = true;
    void experiment.logImpression({
      seriesId,
      posterId: resolved.posterId,
      unit,
      propensity: resolved.propensity,
    });
  }, [experiment, resolved, seriesId, unit]);

  // Observe the poster element. When it intersects the viewport, log the impression. We re-evaluate when
  // the resolved selection lands so a poster already on screen still logs once the id is known.
  const observe = useCallback(
    (node: E | null) => {
      elementRef.current = node;
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node) return;
      const Ctor = opts.intersectionObserver ?? noopObserver;
      if (!Ctor) {
        // No IntersectionObserver (older runtime / test env without a shim): degrade to logging on mount
        // once the selection is known, so the impression is never lost (no dead end).
        maybeLogImpression();
        return;
      }
      const obs = new Ctor((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            maybeLogImpression();
            break;
          }
        }
      });
      obs.observe(node);
      observerRef.current = obs;
    },
    [opts.intersectionObserver, maybeLogImpression],
  );

  // When the selection resolves after the element is already mounted/visible, attempt the impression.
  useEffect(() => {
    if (resolved && elementRef.current && !observerRef.current) {
      maybeLogImpression();
    }
  }, [resolved, maybeLogImpression]);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    },
    [],
  );

  const onActivate = useCallback(() => {
    if (!resolved) return;
    void experiment.logClick({
      seriesId,
      posterId: resolved.posterId,
      unit,
      propensity: resolved.propensity,
    });
  }, [experiment, resolved, seriesId, unit]);

  return { ref: observe, posterUrl, posterId, onActivate };
}
