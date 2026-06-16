// Captions with Intention, faithful to the CWI spec, recalibrated for the 9:16 vertical player.
//
// THREE INDEPENDENT SIGNALS -> THREE ROBOTO FLEX AXES (per word, from the producer's raw values):
//   energy_rms     -> SIZE   (volume to size; 3 / 5 / 12 percent ratio, whisper / normal / scream)
//   f0_hz          -> WEIGHT (pitch to weight; higher pitch lighter, 80..250 Hz -> 1000..100)
//   harmonic_ratio -> WIDTH  (harmonics to width; fuller/lower harmonics wider, 25..151)
// Character color from the CI palette; word states differ by OPACITY (read-ahead), never by hue. Captions sit
// in a 90 percent black box in the vertical work area, above the controls and clear of the right rail; a loud
// burst (toward 12 percent) breaks out of the box. Vertical recalibration: the size base is pegged to the
// column width so a normal caption is readable, while the 3:5:12 ratio is preserved. No em dashes.

import { useEffect, useMemo, useRef, useState } from "react";
import { paginateTwoLinesByWidth, type FontOpts } from "./captionsFit.js";
import {
  characterColor,
  sizePercentFromEnergy,
  weightFromF0,
  widthFromHarmonics,
  type CaptionMeta,
  type CaptionSegment,
} from "./captionsModel.js";

export interface CaptionsWithIntentionProps {
  segments: CaptionSegment[];
  meta?: CaptionMeta;
  currentTimeMs: number;
  enabled: boolean;
}

const FONT_FAMILY = '"Roboto Flex", Inter, system-ui, sans-serif';

export function CaptionsWithIntention({ segments, meta, currentTimeMs, enabled }: CaptionsWithIntentionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);

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

  // VERTICAL RECALIBRATION: peg the 5 percent (normal) caption to a readable fraction of the column width, so
  // captions are proportionate in 9:16 rather than a literal 5 percent of the tall portrait height. The
  // 3:5:12 ratio is preserved by scaling each word by sizePercent / 5.
  const baseUnitPx = useMemo(() => Math.min(30, Math.max(18, width * 0.066)), [width]);

  const active = useMemo(
    () => segments.find((s) => currentTimeMs >= s.startTime * 1000 && currentTimeMs < s.endTime * 1000),
    [segments, currentTimeMs],
  );

  const page = useMemo(() => {
    if (!active) return undefined;
    const fontOpts: FontOpts = { fontFamily: FONT_FAMILY, fontSizePx: baseUnitPx, fontWeight: 500 };
    const pages = paginateTwoLinesByWidth(active, fontOpts, Math.max(160, width - 28));
    return pages.find((p) => currentTimeMs >= p.startTime * 1000 && currentTimeMs < p.endTime * 1000) ?? pages[0];
  }, [active, baseUnitPx, width, currentTimeMs]);

  if (!enabled || !active || !page) {
    // Keep the measuring container mounted so the column width is known when a caption appears.
    return <div ref={ref} data-testid="captions-ci" style={{ width: "100%" }} aria-live="polite" />;
  }

  const color = characterColor(active);
  const isSfx = active.type === "soundeffect";
  const isMusic = active.type === "music";
  // Sound effects and music are WHITE, not character-colored. Music is static (not animated).
  const baseColor = isSfx || isMusic ? "#FFFFFF" : color;

  return (
    <div ref={ref} data-testid="captions-ci" data-speaker={active.speaker} data-emotion={active.emotion ?? ""} style={{ width: "100%", display: "flex", justifyContent: "center" }}>
      {/* 90 percent black captions box, sized to the column; overflow visible so a loud burst can break out. */}
      <div
        data-testid="captions-box"
        aria-live="polite"
        style={{
          maxWidth: "100%",
          background: "rgba(0,0,0,0.9)",
          borderRadius: 12,
          padding: "8px 14px",
          textAlign: "center",
          lineHeight: 1.18,
          overflow: "visible",
        }}
      >
        {isMusic && <span style={{ color: "#FFF", margin: "0 0.3em" }} aria-hidden="true">&#9834;</span>}
        {page.words.map((word, i) => {
          const w = word as typeof word & { energy_rms?: number; f0_hz?: number; harmonic_ratio?: number };
          const sizePct = sizePercentFromEnergy(w.energy_rms, meta); // 3..12
          const sizePx = Math.round(baseUnitPx * (sizePct / 5));
          const weight = isMusic ? 400 : weightFromF0(w.f0_hz, meta);
          const wdth = isMusic ? 100 : widthFromHarmonics(w.harmonic_ratio);
          const burst = sizePct >= 11; // loud burst breaks the box
          // CWI read-ahead: 3 states by the word clock, same hue, differ by opacity (music is static/full).
          const startMs = word.startTime * 1000;
          const endMs = word.endTime * 1000;
          const state = isMusic ? "active" : currentTimeMs >= endMs ? "spoken" : currentTimeMs >= startMs ? "active" : "upcoming";
          const opacity = state === "active" ? 1 : state === "spoken" ? 0.85 : 0.5;
          const text = isSfx ? `[${word.text.replace(/[[\]]/g, "")}]` : word.text;
          return (
            <span
              key={`${word.startTime}-${i}`}
              data-state={state}
              data-size-pct={sizePct.toFixed(1)}
              data-weight={weight}
              data-width={wdth}
              style={{
                display: "inline-block",
                margin: "0 0.14em",
                fontFamily: FONT_FAMILY,
                fontSize: sizePx,
                fontWeight: weight,
                fontVariationSettings: `"wght" ${weight}, "wdth" ${wdth}, "opsz" 12`,
                color: baseColor,
                opacity,
                position: burst ? "relative" : undefined,
                zIndex: burst ? 1 : undefined,
                textShadow: "0 2px 8px rgba(0,0,0,0.9)",
                transition: "opacity 0.1s linear, font-size 0.1s linear",
              }}
            >
              {text}
            </span>
          );
        })}
        {isMusic && <span style={{ color: "#FFF", margin: "0 0.3em" }} aria-hidden="true">&#9834;</span>}
      </div>
    </div>
  );
}
