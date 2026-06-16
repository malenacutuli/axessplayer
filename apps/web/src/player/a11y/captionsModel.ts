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

// Pitch-driven font VARIATION (weight + width). Lifted concept: weight by pitch/intensity, width 75..125.
// VERTICAL ADAPTATION: clamp the width contribution near 110 on a narrow column so emphasis never breaks the
// line box (directive A.3).
export function fontVariation(word: CaptionWord, intensity: Intensity, narrow: boolean): string {
  const wght = getFontWeight(intensity);
  const pitch = word.pitch ?? "normal";
  // width: high pitch widens, low pitch narrows, around a 100 baseline.
  let wdth = pitch === "high" ? 118 : pitch === "low" ? 82 : 100;
  if (narrow) wdth = Math.min(wdth, 110);
  return `'wght' ${wght}, 'wdth' ${wdth}, 'opsz' 24`;
}

// Character color: the segment's assigned speakerColor (from the CI palette), else neutral.
export function characterColor(seg: CaptionSegment | undefined): string {
  return seg?.speakerColor || DEFAULT_NEUTRAL;
}
