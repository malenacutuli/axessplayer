// Settings: account, tier, and studio preferences. The tier switch lets a creator move between solo /
// agency / production; agency and production reveal their coming-soon advanced capability so the upgrade is
// honest about what is built. The Simple / Pro mode lives here too (mirrors the rail toggle). Built on the
// @axessplayer/ui design system. WCAG AA: labelled controls, a real fieldset for the tier choice. No em
// dashes.
import { Card, Toggle } from "@axessplayer/ui";
import { CREATOR_TIERS, tierInfo, useCreatorAuth } from "../auth/creatorAuth.js";

export function SettingsPanel(): JSX.Element {
  const { session, mode, setMode, setTier } = useCreatorAuth();
  const tier = session ? tierInfo(session.tier) : tierInfo("solo");
  const isPro = mode === "pro";

  return (
    <div className="spanel" data-testid="panel-settings">
      <div className="sbar">
        <div>
          <div className="ey rose">Account</div>
          <h2 style={{ marginTop: 8 }}>Settings</h2>
        </div>
      </div>

      <div className="dash-grid">
        <Card title="Studio mode" subtitle="Simple keeps the workspace focused. Pro reveals advanced sections." data-testid="settings-mode">
          <div className="rail-mode" style={{ marginTop: 10 }}>
            <Toggle checked={isPro} onChange={(v) => setMode(v ? "pro" : "simple")} label="Pro mode" />
            <span className="rail-mode__label">{isPro ? "Pro" : "Simple"}</span>
          </div>
        </Card>

        <Card title="Plan" subtitle={`You are on the ${tier.label} tier.`} data-testid="settings-tier">
          <fieldset className="tiers" data-testid="settings-tier-picker" style={{ marginTop: 8 }}>
            <legend className="fld-legend">Change tier</legend>
            {CREATOR_TIERS.map((t) => (
              <label
                key={t.id}
                className={`tier ${session?.tier === t.id ? "on" : ""}`}
                data-testid={`settings-tier-${t.id}`}
                data-selected={session?.tier === t.id}
              >
                <input
                  type="radio"
                  name="settings-tier"
                  value={t.id}
                  checked={session?.tier === t.id}
                  onChange={() => setTier(t.id)}
                />
                <span className="tier-body">
                  <span className="tier-label">{t.label}</span>
                  <span className="tier-blurb">{t.blurb}</span>
                  {t.comingSoon && <span className="tier-soon">{t.comingSoon} coming soon</span>}
                </span>
              </label>
            ))}
          </fieldset>
        </Card>
      </div>
    </div>
  );
}
