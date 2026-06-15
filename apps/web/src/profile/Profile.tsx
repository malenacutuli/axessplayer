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
}

export function Profile({ name, coins, consent }: ProfileProps) {
  return (
    <div className="pad" data-testid="profile">
      <div className="profhead">
        <div className="avatar" aria-hidden="true" />
        <div>
          <div className="nm">{name}</div>
          <div className="muted">Member · {coins ?? "…"} coins</div>
        </div>
      </div>

      <div className="row">
        <div className="ic" aria-hidden="true">▤</div>
        <div style={{ flex: 1 }}>Continue watching</div>
      </div>
      <div className="row">
        <div className="ic" aria-hidden="true">♡</div>
        <div style={{ flex: 1 }}>My list</div>
      </div>
      <div className="row">
        <div className="ic" aria-hidden="true">⚙</div>
        <div style={{ flex: 1 }}>Accessibility defaults</div>
      </div>
      <div className="row">
        <div className="ic" aria-hidden="true">⤓</div>
        <div style={{ flex: 1 }}>Downloads</div>
      </div>

      {consent ? <PrivacyDataPanel consent={consent} /> : null}
    </div>
  );
}
