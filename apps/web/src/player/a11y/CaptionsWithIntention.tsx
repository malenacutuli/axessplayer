// Captions with Intention, rewritten for the 9:16 vertical player. The ENGINE (schema, CI_COLORS, the
// intensity->typography mapping, the pixel-accurate pagination in captionsFit) is lifted verbatim from the
// Axessible repo; only the presentation is vertical:
//   - line length keyed to the measured narrow column (directive A.1), not the landscape 40 chars
//   - font size keyed to the column width (vw-relative), never shrinking to 14px (A.2)
//   - the width axis is clamped near 110 so emphasis never breaks the line box (A.3)
//   - rendered inside the caption safe area, above the controls and clear of the right rail (A.4)
// Word-by-word: spoken words are full character color, upcoming words read-ahead dim. No em dashes.

import { useEffect, useMemo, useRef, useState } from "react";
import { paginateTwoLinesByWidth, type FontOpts } from "./captionsFit.js";
import {
  CI_COLORS,
  calculateIntensity,
  characterColor,
  fontVariation,
  getFontSizeMultiplier,
  shouldUseAllCaps,
  type CaptionSegment,
} from "./captionsModel.js";

export interface CaptionsWithIntentionProps {
  segments: CaptionSegment[];
  currentTimeMs: number;
  enabled: boolean;
}

const FONT_FAMILY = "Inter, system-ui, sans-serif";

export function CaptionsWithIntention({ segments, currentTimeMs, enabled }: CaptionsWithIntentionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);

  // Measure the real column width so pagination wraps to the 9:16 column (not a landscape constant).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(180, el.clientWidth));
    update();
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, []);

  // Font size keyed to the column width (legible at phone width, never the landscape 14px floor).
  const basePx = useMemo(() => Math.min(30, Math.max(17, Math.round(width * 0.07))), [width]);

  // The segment on screen now.
  const active = useMemo(
    () => segments.find((s) => currentTimeMs >= s.startTime * 1000 && currentTimeMs < s.endTime * 1000),
    [segments, currentTimeMs],
  );

  // Paginate the active segment to the measured narrow column using the lifted pixel-accurate fit.
  const page = useMemo(() => {
    if (!active) return undefined;
    const fontOpts: FontOpts = { fontFamily: FONT_FAMILY, fontSizePx: basePx, fontWeight: 600 };
    // maxWidth keyed to the column with side padding; this is what makes ~24 chars/line on a phone.
    const pages = paginateTwoLinesByWidth(active, fontOpts, Math.max(160, width - 24));
    return pages.find((p) => currentTimeMs >= p.startTime * 1000 && currentTimeMs < p.endTime * 1000) ?? pages[0];
  }, [active, basePx, width, currentTimeMs]);

  if (!enabled || !active || !page) {
    // Keep the measuring container mounted so width is known when a caption appears.
    return <div ref={ref} data-testid="captions-ci" style={{ width: "100%" }} aria-live="polite" />;
  }

  const color = characterColor(active);

  return (
    <div
      ref={ref}
      data-testid="captions-ci"
      data-speaker={active.speaker}
      data-speaker-color={color}
      aria-live="polite"
      style={{ width: "100%", textAlign: "center", lineHeight: 1.25 }}
    >
      {page.words.map((word, i) => {
        const intensity = calculateIntensity(word);
        const spoken = currentTimeMs >= word.startTime * 1000;
        const allCaps = shouldUseAllCaps(intensity);
        const sizePx = Math.round(basePx * getFontSizeMultiplier(intensity));
        return (
          <span
            key={`${word.startTime}-${i}`}
            data-emphasis={intensity}
            data-spoken={spoken ? "true" : "false"}
            style={{
              display: "inline-block",
              margin: "0 0.18em",
              fontFamily: FONT_FAMILY,
              fontSize: sizePx,
              fontVariationSettings: fontVariation(word, intensity, true),
              fontStyle: word.emphasis === "whisper" || intensity === "whisper" ? "italic" : "normal",
              textTransform: allCaps ? "uppercase" : "none",
              color: spoken ? color : CI_COLORS.readahead,
              opacity: spoken ? 1 : 0.55,
              textShadow: "0 2px 8px rgba(0,0,0,0.85)",
              transition: "opacity 0.12s linear, color 0.12s linear",
            }}
          >
            {word.text}
          </span>
        );
      })}
    </div>
  );
}
