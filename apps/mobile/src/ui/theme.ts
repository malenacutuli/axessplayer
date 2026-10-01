// Design tokens. High contrast on black (WCAG AA or better for all text pairs here), 48 dp minimum touch
// targets, spacing in dp. Text never sets a fixed height so OS font scaling can grow it. No em dashes.

export const colors = {
  bg: "#000000",
  surface: "#141414",
  surfaceRaised: "#1F1F1F",
  border: "#3A3A3A",
  text: "#FFFFFF",
  textMuted: "#C8C8C8",
  accent: "#FFD23F",
  accentText: "#000000",
  danger: "#FF8A80",
  sponsorBg: "#FFF4CC",
  sponsorText: "#1A1400",
  scrim: "rgba(0,0,0,0.55)",
};

export const MIN_TOUCH = 48;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const type = {
  title: { fontSize: 20, fontWeight: "700" as const },
  body: { fontSize: 16 },
  small: { fontSize: 14 },
  label: { fontSize: 15, fontWeight: "600" as const },
};
