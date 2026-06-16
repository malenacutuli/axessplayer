// Captions with Intention model and typography, lifted verbatim from the Axessible engine
// (mvpsigndemo src/components/CaptionsWithIntention.tsx). This is the differentiator: the CaptionSegment /
// CaptionWord schema (ms timing, 7-level intensity, speakerColor, emphasis, syllables), the CI_COLORS
// palette, and the intensity->typography mapping. The presentation is rewritten for 9:16 in
// CaptionsWithIntention.tsx; the LOGIC here is unchanged. No em dashes.

// Captions with Intention color palette following the official protocol.
export const CI_COLORS = {
  readahead: "rgba(255, 255, 255, 0.9)",
  main: {
    yellow: "#E5E517",
    blue: "#17E5E5",
    red: "#E51717",
    orange: "#E58017",
    green: "#17E517",
    pink: "#E517E5",
  },
  supporting: {
    orange1: "#E85C2E",
    blue1: "#47C2EB",
    yellow1: "#EBC247",
    blue2: "#5E82ED",
    green1: "#C2EB47",
    purple1: "#8C6BED",
    green2: "#82ED5E",
    purple2: "#CC6BED",
    green3: "#47EB70",
    pink1: "#EB47C2",
    cyan: "#5EEDC9",
    pink2: "#ED5E82",
  },
} as const;

export const DEFAULT_NEUTRAL = "#22E3D0";

export type Intensity = "whisper" | "quiet" | "normal" | "loud" | "yelling" | "screaming";

export interface CaptionWord {
  text: string;
  start_ms?: number;
  end_ms?: number;
  startTime: number; // seconds
  endTime: number;
  confidence?: number;
  syllables?: Array<{ text: string; startTime: number; endTime: number }>;
  intensity?: Intensity;
  overall_intensity?: string;
  emphasis?: "loud" | "quiet" | "normal" | "yelling" | "whisper";
  pitch?: "high" | "low" | "normal";
  sentiment?: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  sentimentConfidence?: number;
  duration_ms?: number;
  // CWI producer raw signals (the three independent inputs). The renderer maps each to a Roboto Flex axis.
  character_id?: string;
  f0_hz?: number; // pitch -> weight
  energy_rms?: number; // volume -> size
  harmonic_ratio?: number; // harmonics (low/total) -> width
}

// Clip-level calibration from the producer, so size/weight map across this clip's actual range.
export interface CaptionMeta {
  font?: string;
  energy?: { p10: number; p50: number; p90: number; max: number };
  f0?: { p10: number; p50: number; p90: number };
}

export interface CaptionSegment {
  text: string;
  speaker: string;
  speakerColor?: string; // character color
  startTime: number; // seconds
  endTime: number;
  words: CaptionWord[];
  overall_intensity?: string;
  type?: "dialogue" | "soundeffect" | "music";
  // BEYOND-AXESSIBLE: the LLM reads the script and tags meaning, fused with DSP. emotion drives a qualitative
  // treatment (temperature/tracking) the loudness heuristic cannot; intent is for downstream use.
  emotion?: string; // cold | tender | panicked | menacing | grave | bitter | triumphant | joyful | neutral
  intent?: string; // threat | plea | lie | reveal | accusation | dismissal | confession | ...
}

// Calculate the 7-level intensity from the word's emotion/timing data (Axessible priority order, verbatim).
export function calculateIntensity(word: CaptionWord): Intensity {
  if (word.intensity) return word.intensity;
  if (word.overall_intensity) return word.overall_intensity as Intensity;
  if (word.sentimentConfidence && word.sentimentConfidence > 0.95 && (word.sentiment === "POSITIVE" || word.sentiment === "NEGATIVE")) return "screaming";
  if (word.sentimentConfidence && word.sentimentConfidence > 0.85 && (word.sentiment === "POSITIVE" || word.sentiment === "NEGATIVE")) return "yelling";
  if (word.sentimentConfidence && word.sentimentConfidence > 0.75 && (word.sentiment === "POSITIVE" || word.sentiment === "NEGATIVE")) return "loud";
  const duration_ms =
    word.duration_ms ?? (word.end_ms && word.start_ms ? word.end_ms - word.start_ms : (word.endTime - word.startTime) * 1000);
  if (duration_ms > 800) return "loud";
  if (duration_ms < 200) return "whisper";
  if (word.emphasis) {
    switch (word.emphasis) {
      case "yelling": return "yelling";
      case "loud": return "loud";
      case "quiet": return "quiet";
      case "whisper": return "whisper";
    }
  }
  return "normal";
}

// Font size multiplier for the 7-level intensity (verbatim).
export function getFontSizeMultiplier(intensity: Intensity): number {
  switch (intensity) {
    case "whisper": return 0.85;
    case "quiet": return 0.9;
    case "normal": return 1.0;
    case "loud": return 1.05;
    case "yelling": return 1.1;
    case "screaming": return 1.15;
    default: return 1.0;
  }
}

// Font weight for the intensity (verbatim).
export function getFontWeight(intensity: Intensity): number {
  switch (intensity) {
    case "whisper": return 300;
    case "quiet": return 400;
    case "normal": return 500;
    case "loud": return 600;
    case "yelling": return 700;
    case "screaming": return 700;
    default: return 500;
  }
}

export function shouldUseAllCaps(intensity: Intensity): boolean {
  return intensity === "yelling" || intensity === "screaming";
}

// BRAND TYPOGRAPHY. The caption font is Inter, a brand font, which has a WEIGHT axis, not a width axis. So
// intensity drives size + weight, and pitch drives LETTER-SPACING (the brand-safe stand-in for the old width
// axis). Returns CSS values, not a font-variation string (which Inter would ignore for wdth).
export function wordTypography(word: CaptionWord, intensity: Intensity): { fontWeight: number; letterSpacingEm: number } {
  const fontWeight = getFontWeight(intensity);
  const pitch = word.pitch ?? "normal";
  const letterSpacingEm = pitch === "high" ? 0.035 : pitch === "low" ? -0.02 : 0;
  return { fontWeight, letterSpacingEm };
}

// Character color: the segment's assigned speakerColor (from the CI palette), else neutral.
export function characterColor(seg: CaptionSegment | undefined): string {
  return seg?.speakerColor || DEFAULT_NEUTRAL;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// CWI THREE-AXIS MAPPINGS (Roboto Flex). Each is an independent signal -> independent axis.

// Volume to SIZE: a CWI size PERCENT in the [3, 12] range, 5 at normal speech (3:5:12 ratio). Mapped across
// the clip's own energy range so a whisper sits near 3 and a shout near 12.
export function sizePercentFromEnergy(energyRms: number | undefined, meta: CaptionMeta | undefined): number {
  if (!energyRms || !meta?.energy) return 5;
  const { p10, p50, p90, max } = meta.energy;
  if (energyRms <= p50) {
    // p10..p50 -> 3..5
    const t = p50 > p10 ? (energyRms - p10) / (p50 - p10) : 0.5;
    return clamp(3 + clamp(t, 0, 1) * 2, 3, 5);
  }
  // p50..p90 -> 5..9, p90..max -> 9..12
  if (energyRms <= p90) {
    const t = p90 > p50 ? (energyRms - p50) / (p90 - p50) : 0.5;
    return clamp(5 + t * 4, 5, 9);
  }
  const t = max > p90 ? (energyRms - p90) / (max - p90) : 1;
  return clamp(9 + clamp(t, 0, 1) * 3, 9, 12);
}

// Pitch to WEIGHT: higher pitch = lighter. Mapped RELATIVE to the clip's own F0 distribution (p10..p90) when
// available, since synthetic/character voices often sit above the 80..250 Hz human band and would otherwise
// all pin to the lightest weight. Falls back to the absolute human band. Roboto Flex weight 100..1000.
export function weightFromF0(f0Hz: number | undefined, meta?: CaptionMeta): number {
  if (!f0Hz || f0Hz <= 0) return 400;
  const f = meta?.f0;
  const lo = f && f.p90 > f.p10 ? f.p10 : 80;
  const hi = f && f.p90 > f.p10 ? f.p90 : 250;
  const t = clamp((f0Hz - lo) / (hi - lo), 0, 1);
  return Math.round(clamp(1000 - t * 900, 100, 1000));
}

// Harmonics to WIDTH: low/total harmonic ratio 0..1 -> Roboto Flex width 25..151 (fuller/lower = wider).
export function widthFromHarmonics(harmonicRatio: number | undefined): number {
  const hr = harmonicRatio == null ? 0.5 : clamp(harmonicRatio, 0, 1);
  return Math.round(clamp(25 + hr * (151 - 25), 25, 151));
}

// EMOTION LAYER (beyond-Axessible). The LLM tags each segment's emotion; this maps emotion to a qualitative
// treatment the loudness heuristic cannot produce: a temperature tint blended INTO the character color (the
// hue stays recognizable), a tracking delta, and italic. So two lines at the same volume but different emotion
// look different. Tints avoid the reserved brand colors (Electric Rose, Gold).
export interface EmotionStyle {
  tint: string;
  tintAlpha: number;
  letterSpacingAddEm: number;
  italic: boolean;
}
const EMOTION_STYLES: Record<string, EmotionStyle> = {
  cold: { tint: "#8FB6D9", tintAlpha: 0.24, letterSpacingAddEm: -0.01, italic: false },
  menacing: { tint: "#7C9CC0", tintAlpha: 0.28, letterSpacingAddEm: -0.015, italic: false },
  grave: { tint: "#9FB0C2", tintAlpha: 0.2, letterSpacingAddEm: 0, italic: false },
  tender: { tint: "#F4C9A8", tintAlpha: 0.22, letterSpacingAddEm: 0.015, italic: true },
  vulnerable: { tint: "#F0CDB6", tintAlpha: 0.2, letterSpacingAddEm: 0.01, italic: true },
  grief: { tint: "#C8C2D6", tintAlpha: 0.22, letterSpacingAddEm: 0.01, italic: true },
  panicked: { tint: "#FF9B6B", tintAlpha: 0.18, letterSpacingAddEm: -0.02, italic: true },
  fearful: { tint: "#FFA877", tintAlpha: 0.16, letterSpacingAddEm: -0.015, italic: true },
  bitter: { tint: "#A7B095", tintAlpha: 0.18, letterSpacingAddEm: 0, italic: false },
  triumphant: { tint: "#FFE39A", tintAlpha: 0.16, letterSpacingAddEm: 0.03, italic: false },
  joyful: { tint: "#FFD98A", tintAlpha: 0.16, letterSpacingAddEm: 0.03, italic: false },
};
export function emotionStyle(emotion?: string): EmotionStyle {
  return (emotion && EMOTION_STYLES[emotion]) || { tint: "#FFFFFF", tintAlpha: 0, letterSpacingAddEm: 0, italic: false };
}

function hexToRgb(h: string): { r: number; g: number; b: number } {
  const n = h.replace("#", "");
  const v = n.length === 3 ? n.split("").map((c) => c + c).join("") : n;
  return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) };
}
// Blend hex a toward hex b by t (0 = a). Keeps the character hue recognizable while shifting temperature.
export function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bl = Math.round(pa.b + (pb.b - pa.b) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}
