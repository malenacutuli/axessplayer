// The 16-section operator-console navigation, grouped exactly as the handoff (Content / People / Business
// / Trust & system) with Dashboard ungrouped at the top. Every item routes to a real route under
// /admin/<section>; the not-yet-built ones render an explicit coming-soon empty state and are reachable
// (no dead end). Icons are inline SVG (project rule: no emoji glyphs). No em dashes.
import * as React from "react";

export interface NavItem {
  key: string;
  label: string;
  path: string;
  icon: React.ReactNode;
}
export interface NavGroup {
  // undefined for the top-level Dashboard row (no section header).
  group?: string;
  items: NavItem[];
}

const s = (d: React.ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
    {d}
  </svg>
);

export const NAV: NavGroup[] = [
  {
    items: [
      {
        key: "dashboard",
        label: "Dashboard",
        path: "/admin/dashboard",
        icon: s(
          <>
            <rect x="3" y="3" width="7" height="9" rx="1" />
            <rect x="14" y="3" width="7" height="5" rx="1" />
            <rect x="14" y="12" width="7" height="9" rx="1" />
            <rect x="3" y="16" width="7" height="5" rx="1" />
          </>,
        ),
      },
    ],
  },
  {
    group: "Content",
    items: [
      { key: "content", label: "Content CMS", path: "/admin/content", icon: s(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 4v16" /></>) },
      { key: "storygraph", label: "Adaptive story graph", path: "/admin/storygraph", icon: s(<><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M6 8.5v3a2 2 0 002 2h8a2 2 0 002-2v-3M12 13.5v2" /></>) },
      { key: "media", label: "Media factory", path: "/admin/media", icon: s(<><path d="M3 5h18v14H3z" /><path d="M10 9l5 3-5 3z" /></>) },
      { key: "accessibility", label: "Accessibility factory", path: "/admin/accessibility", icon: s(<><circle cx="12" cy="4" r="2" /><path d="M5 8h14M12 8v8M12 16l-3 4M12 16l3 4" /></>) },
      { key: "brands", label: "Brand integration", path: "/admin/brands", icon: s(<path d="M3 9l2-5h14l2 5M3 9v10a1 1 0 001 1h16a1 1 0 001-1V9M3 9h18M9 13h6" />) },
    ],
  },
  {
    group: "People",
    items: [
      { key: "users", label: "Users", path: "/admin/users", icon: s(<><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.5 3-5.5 6-5.5s6 2 6 5.5M16 5.5a3 3 0 010 5.5M18 20c0-2.5-1-4-2.5-4.8" /></>) },
      { key: "creators", label: "Creators", path: "/admin/creators", icon: s(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>) },
      { key: "moderation", label: "Community & moderation", path: "/admin/moderation", icon: s(<><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /><path d="M12 9v4M12 16v.5" /></>) },
    ],
  },
  {
    group: "Business",
    items: [
      { key: "monetization", label: "Monetization", path: "/admin/monetization", icon: s(<><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4" /></>) },
      { key: "analytics", label: "Analytics", path: "/admin/analytics", icon: s(<path d="M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6M20 16v-2" />) },
      { key: "growth", label: "Growth & UA", path: "/admin/growth", icon: s(<path d="M3 17l6-6 4 4 7-8M21 7v5M21 7h-5" />) },
      { key: "billing", label: "Billing & payouts", path: "/admin/billing", icon: s(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>) },
    ],
  },
  {
    group: "Trust & system",
    items: [
      { key: "trust", label: "Rights, consent, provenance", path: "/admin/trust", icon: s(<><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></>) },
      { key: "health", label: "System health", path: "/admin/health", icon: s(<path d="M3 12h4l2 6 4-14 2 8h6" />) },
      { key: "settings", label: "Settings & roles", path: "/admin/settings", icon: s(<><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 00-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 00-1.7-1l-.3-2.5h-4l-.3 2.5a7 7 0 00-1.7 1l-2.4-1-2 3.5 2 1.5a7 7 0 000 2l-2 1.5 2 3.5 2.4-1a7 7 0 001.7 1l.3 2.5h4l.3-2.5a7 7 0 001.7-1l2.4 1 2-3.5-2-1.5a7 7 0 00.1-1z" /></>) },
    ],
  },
];

// All nav items, flattened, for route matching.
export const NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);
