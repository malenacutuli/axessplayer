// The studio left rail: the "axess studio" wordmark and the panel nav, matching the prototype. The active
// panel button gets the .on class (white pill, rose icon). No em dashes.

export type PanelId = "library" | "produce" | "branch" | "media" | "poster" | "pricing" | "publish" | "operator";

const ICONS: Record<PanelId, JSX.Element> = {
  library: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  ),
  branch: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="5" cy="12" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M7 12h6M13 12l4-5M13 12l4 5" />
    </svg>
  ),
  media: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M21 15V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9" />
      <path d="M3 16l5-5 4 4" />
    </svg>
  ),
  poster: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="M5 19l5-5 4 3 3-3 2 2" />
    </svg>
  ),
  pricing: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9h4a2 2 0 0 1 0 4h-2v3" />
    </svg>
  ),
  publish: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  ),
  operator: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M3 3v18h18" />
      <path d="M7 14l3-4 3 3 4-6" />
    </svg>
  ),
  produce: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 3v12" />
      <path d="M8 11l4 4 4-4" />
      <path d="M5 19h14" />
    </svg>
  ),
};

const NAV: Array<{ id: PanelId; label: string }> = [
  { id: "library", label: "Library" },
  { id: "produce", label: "Produce" },
  { id: "branch", label: "Branch editor" },
  { id: "media", label: "Media & variants" },
  { id: "poster", label: "Poster" },
  { id: "pricing", label: "Pricing" },
  { id: "publish", label: "Publish" },
  { id: "operator", label: "Operator" },
];

export interface SideRailProps {
  active: PanelId;
  onSelect: (id: PanelId) => void;
}

export function SideRail({ active, onSelect }: SideRailProps): JSX.Element {
  return (
    <div className="srail">
      <div className="lg">
        <span className="mk" />
        axess<span className="pl">studio</span>
      </div>
      <nav className="snav" aria-label="Studio sections">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={active === item.id ? "on" : undefined}
            aria-current={active === item.id ? "page" : undefined}
            onClick={() => onSelect(item.id)}
            data-testid={`nav-${item.id}`}
          >
            {ICONS[item.id]}
            {item.label}
          </button>
        ))}
      </nav>
      <div className="help">
        Signed in as
        <br />
        <b>Axessible Studio</b>
      </div>
    </div>
  );
}
