// Axessplayer design tokens. Single source of truth for brand color, type, and
// spacing across web, studio, and mobile surfaces.
//
// Source of truth: Axessplayer Brand Guidelines and the Captions With Intention
// Design System V1.02. Do not hand-edit hex values in surface code. Import from
// here. No em dashes. No emoji in product UI.
//
// Owner workstream: W6 (ui). Consumers read these tokens; they never redefine them.

export const color = {
  // Core system. Ink carries the system. Electric Rose is the single focal accent,
  // used once per layout. Gold is reserved for premium and credits moments.
  ink: "#111114",
  inkSoft: "#2A2A2E",
  electricRose: "#FF2E6E",
  electricRoseHi: "#FF5C8D",
  electricRoseLo: "#E0246B",
  gold: "#E8B54B",

  // Neutrals.
  paper: "#FAFAF8",
  bone: "#F4F2EC",
  line: "#ECECEC",
  muted: "#6B6B72",
  mutedSoft: "#9A9AA0",
  carbon: "#0B0B0D",
  slate: "#3A3A40",
  white: "#FFFFFF",

  // Functional.
  danger: "#E5484D",
  info: "#2E8BFF",
} as const;

// Captions With Intention character palette. Color is an opt-in layer that never
// conveys meaning alone; a non-color fallback (name tag and position) is always
// present. The six-color main-character subset is assigned first, hero and villain
// placed opposite on the spectrum. The full set extends to large casts.
export const cwiPalette = {
  primary6: {
    yellow: "#E5E517",
    cyan: "#17E5E5",
    red: "#E51717",
    orange: "#E58017",
    green: "#17E517",
    magenta: "#E517E5",
  },
} as const;

export const typography = {
  // Outfit for display and headlines, always lowercase, SemiBold or Bold.
  display: "Outfit, sans-serif",
  // Inter for text, UI, and data.
  text: "Inter, sans-serif",
  // JetBrains Mono for mono labels, codes, and data tags, uppercase and tracked out.
  mono: "'JetBrains Mono', monospace",
  // Roboto Flex is the variable-typography engine inside the CWI caption layer only.
  caption: "'Roboto Flex', sans-serif",
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
  xxl: 64,
} as const;

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

// Caption volume mapping is expressed as a percentage of screen height so it is
// resolution independent. Baseline normal speech is 5 percent of screen height.
export const captionSizing = {
  baselineHeightPct: 5,
  minHeightPct: 3.2,
  maxHeightPct: 9,
  emphasisPopPct: 15,
} as const;

export const brand = { color, cwiPalette, typography, space, radius, captionSizing } as const;
export type Brand = typeof brand;
export default brand;
