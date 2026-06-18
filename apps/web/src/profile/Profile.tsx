// The profile screen, matching the prototype's "You" tab: a rose-to-gold gradient avatar, the
// member line with the live coin balance, and a list of rows (Continue watching, My list,
// Accessibility defaults, Downloads). When mounted behind the consent gate, it also shows the Privacy and
// data controls (the GDPR data-subject rights). No em dashes.

import { PrivacyDataPanel } from "../consent/PrivacyDataPanel.js";
import type { ConsentControls } from "../consent/useConsent.js";

export interface ProfileProps {
  name: string;
  coins: number | null;
  consent?: ConsentControls;
  // 20-V4: open the Library route at a given tab. Wires the "My list" / "History" / "Downloads" rows
  // (no dead ends). Optional so the screen still renders in isolation.
  onOpenLibrary?: (tab: "saved" | "downloads" | "history" | "favorites") => void;
}

export function Profile({ name, coins, consent, onOpenLibrary }: ProfileProps) {
  const open = (tab: "saved" | "downloads" | "history" | "favorites") => () => onOpenLibrary?.(tab);
  return (
    <div className="pad" data-testid="profile">
      <div className="profhead">
        <div className="avatar" aria-hidden="true" />
        <div>
          <div className="nm">{name}</div>
          <div className="muted">Member · {coins ?? "…"} coins</div>
        </div>
      </div>

      <button type="button" className="row row--btn" data-testid="profile-history" onClick={open("history")}>
        <span className="ic" aria-hidden="true">
          <RowIcon kind="history" />
        </span>
        <span style={{ flex: 1, textAlign: "left" }}>Continue watching</span>
        <ChevronRight />
      </button>
      <button type="button" className="row row--btn" data-testid="profile-mylist" onClick={open("saved")}>
        <span className="ic" aria-hidden="true">
          <RowIcon kind="heart" />
        </span>
        <span style={{ flex: 1, textAlign: "left" }}>My list</span>
        <ChevronRight />
      </button>
      <button type="button" className="row row--btn" data-testid="profile-favorites" onClick={open("favorites")}>
        <span className="ic" aria-hidden="true">
          <RowIcon kind="star" />
        </span>
        <span style={{ flex: 1, textAlign: "left" }}>Favorites</span>
        <ChevronRight />
      </button>
      <button type="button" className="row row--btn" data-testid="profile-downloads" onClick={open("downloads")}>
        <span className="ic" aria-hidden="true">
          <RowIcon kind="download" />
        </span>
        <span style={{ flex: 1, textAlign: "left" }}>Downloads</span>
        <ChevronRight />
      </button>

      {consent ? <PrivacyDataPanel consent={consent} /> : null}
    </div>
  );
}

function ChevronRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RowIcon({ kind }: { kind: "history" | "heart" | "star" | "download" }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none" as const, "aria-hidden": true };
  if (kind === "history")
    return (
      <svg {...common}>
        <path d="M3 12a9 9 0 1 0 3-6.7M3 4v3.5H6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (kind === "heart")
    return (
      <svg {...common}>
        <path
          d="M12 20s-7-4.3-7-9.3A3.7 3.7 0 0 1 12 8a3.7 3.7 0 0 1 7 2.7c0 5-7 9.3-7 9.3z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    );
  if (kind === "star")
    return (
      <svg {...common}>
        <path
          d="M12 3l2.6 5.6 6 .7-4.5 4 1.3 5.9L12 16.9 6.6 19.2l1.3-5.9-4.5-4 6-.7L12 3z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
