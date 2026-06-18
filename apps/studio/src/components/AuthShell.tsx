// Creator Studio auth shell (prompt 22, section 1). When no creator is signed in, this is the only surface:
// pick a tier (solo / agency / production) and enter the studio. There is no creator-auth backend yet, so
// "sign in" is a local session that unlocks the studio. Agency/production reveal a coming-soon note for
// their advanced multi-X capability but still let the creator in (the tier shapes which sections appear).
// Built on the @axessplayer/ui STUDIO skin. WCAG AA: a real form, labelled controls, one focal action.
// No em dashes.
import { useState } from "react";
import { Button, SkinScope } from "@axessplayer/ui";
import { CREATOR_TIERS, type CreatorTier, useCreatorAuth } from "../auth/creatorAuth.js";

export function AuthShell(): JSX.Element {
  const { signIn } = useCreatorAuth();
  const [name, setName] = useState("");
  const [tier, setTier] = useState<CreatorTier>("solo");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    signIn({ name: name.trim() || "Axessible Studio", tier });
  };

  return (
    <SkinScope skin="studio">
      <div className="auth-shell" data-testid="auth-shell">
        <div className="auth-card">
          <div className="lg" style={{ marginBottom: 18 }}>
            <span className="mk" aria-hidden />
            axess<span className="pl">studio</span>
          </div>
          <div className="ey rose">Creator sign in</div>
          <h1 style={{ fontSize: 26, marginTop: 8 }}>Bring your story to every viewer.</h1>
          <p className="muted" style={{ marginTop: 8, marginBottom: 18 }}>
            Accessibility is on by default. Captions, audio description, sign language, and dubs ship with
            every cut.
          </p>

          <form onSubmit={onSubmit} data-testid="auth-form" aria-describedby="auth-help">
            <div className="fld">
              <label htmlFor="creator-name">Creator or studio name</label>
              <input
                id="creator-name"
                name="creator-name"
                type="text"
                autoComplete="organization"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Axessible Studio"
              />
            </div>

            <fieldset className="tiers" data-testid="tier-picker">
              <legend className="fld-legend">Choose a tier</legend>
              {CREATOR_TIERS.map((t) => (
                <label
                  key={t.id}
                  className={`tier ${tier === t.id ? "on" : ""}`}
                  data-testid={`tier-${t.id}`}
                  data-selected={tier === t.id}
                >
                  <input
                    type="radio"
                    name="tier"
                    value={t.id}
                    checked={tier === t.id}
                    onChange={() => setTier(t.id)}
                  />
                  <span className="tier-body">
                    <span className="tier-label">{t.label}</span>
                    <span className="tier-blurb">{t.blurb}</span>
                    {t.comingSoon && (
                      <span className="tier-soon" data-testid={`tier-soon-${t.id}`}>
                        {t.comingSoon} coming soon
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>

            <Button type="submit" variant="primary" size="lg" data-testid="auth-submit" style={{ width: "100%", marginTop: 6 }}>
              Enter studio
            </Button>
            <p id="auth-help" className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              This is a creator workspace. Your identity is never sent in content requests.
            </p>
          </form>
        </div>
      </div>
    </SkinScope>
  );
}
