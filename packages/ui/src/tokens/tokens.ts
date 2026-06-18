// Axessplayer design tokens as TypeScript constants. Mirrors tokens.css for JS/RN consumers and tests.
// CSS-driven surfaces import tokens.css; native (apps/mobile) and logic that needs values import this.
// Single source of truth alongside the CSS. No em dashes.

export const color = {
  bg: "#0B0B0D",
  board: "#08080A",
  surface: "#15151b",
  card: "#16161c",
  rail: "#0E0E12",
  border: "#1f1f25",
  border2: "#20202a",
  border3: "#26262d",
  hairline: "#1a1a20",
  ink: "#FAFAF8",
  ink2: "#C9C9CF",
  muted: "#9A9AA0",
  faint: "#6B6B72",
  faintest: "#54545C",
  rose: "#FF2E6E",
  roseSoft: "#FF8FB4",
  roseDeep: "#cf1d57",
  gold: "#E8B54B",
  success: "#1F8A5B",
  info: "#5aa6ff",
  danger: "#ff5f57",
  warning: "#E8B54B",
  roseFill08: "rgba(255,46,110,0.08)",
  roseFill12: "rgba(255,46,110,0.12)",
  roseFill16: "rgba(255,46,110,0.16)",
  goldTint14: "rgba(232,181,75,0.14)",
  goldTint16: "rgba(232,181,75,0.16)",
  bandRose: "rgba(255,46,110,0.16)",
  bandInfo: "rgba(90,166,255,0.16)",
} as const;

export const font = {
  display: '"Outfit", system-ui, -apple-system, "Segoe UI", sans-serif',
  body: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  weight: { regular: 400, medium: 500, semibold: 600 },
  letterSpacing: { displayLg: "-0.035em", displaySm: "-0.02em", mono: "0.14em", wordmark: "-0.045em" },
} as const;

export const radius = { card: 14, cardLg: 16, pill: 999, phone: 46 } as const;

export const space = { panel: 20, pageY: 30, pageX: 36 } as const;

export const shadow = {
  phone: "0 40px 80px -30px rgba(0,0,0,0.9)",
  card: "0 8px 24px -12px rgba(0,0,0,0.6)",
  roseGlow: "0 14px 30px -10px rgba(255,46,110,0.7)",
} as const;

export type Skin = "viewer" | "studio" | "admin";

// Accessibility-track badge kinds shown across surfaces (CC/AD/SIGN/language/C2PA/readiness).
export type BadgeKind = "cc" | "ad" | "sign" | "lang" | "c2pa" | "ready";

// Status-chip semantics for tables (content lifecycle, jobs).
export type StatusKind = "live" | "review" | "processing" | "draft" | "failed";
