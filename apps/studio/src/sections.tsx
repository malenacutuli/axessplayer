// The 14 Creator Studio sections (prompt 22 left rail). Each is a real, reachable route (slug). Some are
// wired to the existing authoring panels (Library, Branch, Media, Poster, Monetization, Analytics map onto
// the live StudioPage workflow); the rest are reachable COMING-SOON routes so the rail is never a dead end.
// Routing truth: every section is linkable via #/studio/<slug>. No em dashes.

export type SectionId =
  | "dashboard"
  | "create"
  | "upload"
  | "library"
  | "branch"
  | "media"
  | "process"
  | "accessibility"
  | "brands"
  | "poster"
  | "posters"
  | "analytics"
  | "monetization"
  | "content"
  | "channel"
  | "team"
  | "rights"
  | "settings";

export interface StudioSection {
  id: SectionId;
  label: string;
  // Whether the section is built today. Not-built sections render a reachable coming-soon surface.
  built: boolean;
  // Pro-only sections are revealed only when the creator turns on Pro mode (data-pro-only pattern).
  proOnly?: boolean;
  // One-line description shown on coming-soon surfaces so the route still communicates intent.
  blurb: string;
}

export const STUDIO_SECTIONS: StudioSection[] = [
  { id: "dashboard", label: "Dashboard", built: true, blurb: "Your channel at a glance." },
  { id: "create", label: "Create with AI", built: true, blurb: "Prompt to series: the writers-room showrunner." },
  { id: "upload", label: "Upload", built: true, blurb: "Drop 9:16 masters; we encode and register them." },
  { id: "library", label: "Library", built: true, blurb: "Every series you have authored." },
  { id: "branch", label: "Branch and endings", built: true, blurb: "Edit the branching story graph, alternate endings, and premium cuts." },
  { id: "media", label: "Media", built: true, blurb: "Manual per-variant authoring (Pro override)." },
  {
    id: "process",
    label: "Make Accessible",
    built: true,
    blurb: "Set targets once; the factory fans out captions, audio description, sign, and dubs.",
  },
  { id: "brands", label: "Brand", built: true, proOnly: true, blurb: "Brand offers and sponsorship, firewalled from content decisions." },
  { id: "poster", label: "Poster", built: true, blurb: "Generate and set the series poster." },
  { id: "posters", label: "Posters and marketing", built: true, blurb: "Posters, A/B variants, localized art, channel creatives, and marketing clips." },
  { id: "analytics", label: "Analytics", built: true, blurb: "Retention and counterfactual lift, shown as bands." },
  { id: "monetization", label: "Monetization", built: true, blurb: "Pricing, the 70/30 revenue share, and payouts." },
  { id: "content", label: "Modify content", built: true, blurb: "Edit a published title: unpublish, replace, enhance, re-run, exclusions." },
  { id: "channel", label: "Channel", built: true, blurb: "Your public channel page and publishing schedule." },
  { id: "team", label: "Team", built: true, proOnly: true, blurb: "Seats, roles, and approvals (Agency and Production tiers)." },
  { id: "rights", label: "Rights", built: false, proOnly: true, blurb: "Licensing, territories, and content rights." },
  { id: "settings", label: "Settings", built: true, blurb: "Account, tier, and studio preferences." },
];

export function sectionById(id: string): StudioSection | undefined {
  return STUDIO_SECTIONS.find((s) => s.id === id);
}

// Section icons (inline SVG, never emoji). Stroke uses currentColor so the rail .on state can tint rose.
export const SECTION_ICONS: Record<SectionId, JSX.Element> = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </svg>
  ),
  create: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  ),
  upload: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  ),
  process: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </svg>
  ),
  library: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  ),
  branch: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="5" cy="12" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M7 12h6M13 12l4-5M13 12l4 5" />
    </svg>
  ),
  media: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M21 15V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9" />
      <path d="M3 16l5-5 4 4" />
    </svg>
  ),
  accessibility: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="12" cy="4" r="1.6" />
      <path d="M4 8h16M12 8v6M9 21l3-7 3 7" />
    </svg>
  ),
  brands: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M20 12l-8 8-8-8 8-8h6a2 2 0 0 1 2 2z" />
      <circle cx="16" cy="8" r="1.4" />
    </svg>
  ),
  poster: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="M5 19l5-5 4 3 3-3 2 2" />
    </svg>
  ),
  posters: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <rect x="3" y="4" width="8" height="16" rx="1.5" />
      <rect x="13" y="4" width="8" height="9" rx="1.5" />
      <path d="M13 16h8M13 19h5" />
    </svg>
  ),
  analytics: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M3 3v18h18" />
      <path d="M7 14l3-4 3 3 4-6" />
    </svg>
  ),
  content: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  monetization: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9h4a2 2 0 0 1 0 4h-2v3" />
    </svg>
  ),
  channel: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M8 6V4h8v2M9 12l4 2-4 2z" />
    </svg>
  ),
  team: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M18 20a6 6 0 0 0-3-5" />
    </svg>
  ),
  rights: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
    </svg>
  ),
};
