// Creator Studio auth shell (prompt 22, section 1). When no creator is signed in, this is the only surface:
// sign in with Supabase (email + password, create account, or Google) and pick a tier (solo / agency /
// production). Agency/production reveal a coming-soon note for their advanced multi-X capability but still
// let the creator in (the tier shapes which sections appear). Dev builds without Supabase config keep a
// local name-only sign-in for local stacks; a production build without config says so instead.
// Built on the @axessplayer/ui STUDIO skin. WCAG AA: a real form, labelled controls, one focal action.
// No em dashes.
import { useState } from "react";
import { Button, SkinScope } from "@axessplayer/ui";
import { CREATOR_TIERS, type CreatorTier, useCreatorAuth } from "../auth/creatorAuth.js";
import { isDevBuild } from "../auth/supabase.js";

export function AuthShell(): JSX.Element {
  const auth = useCreatorAuth();
  const { signIn } = auth;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tier, setTier] = useState<CreatorTier>("solo");
  const real = auth.supabaseAuth;
  const localAllowed = !real && isDevBuild();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (real) void auth.signInWithPassword(email.trim(), password, tier);
    else if (localAllowed) signIn({ name: name.trim() || "Axessible Studio", tier });
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
            {real ? (
              <>
                <div className="fld">
                  <label htmlFor="creator-email">Email</label>
                  <input id="creator-email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="fld">
                  <label htmlFor="creator-password">Password</label>
                  <input id="creator-password" name="password" type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </>
            ) : localAllowed ? (
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
            ) : (
              <p className="muted" data-testid="auth-unconfigured" role="alert">
                Studio sign-in is not configured for this deployment.
              </p>
            )}

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

            {auth.error && (
              <p className="err" role="alert" data-testid="auth-error">
                {auth.error}
              </p>
            )}
            {auth.notice && (
              <p className="muted" role="status" data-testid="auth-notice">
                {auth.notice}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" data-testid="auth-submit" disabled={auth.busy || (!real && !localAllowed)} style={{ width: "100%", marginTop: 6 }}>
              {real ? "Sign in" : "Enter studio"}
            </Button>
            {real && (
              <>
                <Button type="button" variant="secondary" size="lg" data-testid="auth-signup" disabled={auth.busy} style={{ width: "100%", marginTop: 8 }} onClick={() => void auth.signUpWithPassword(email.trim(), password, tier)}>
                  Create account
                </Button>
                <Button type="button" variant="secondary" size="lg" data-testid="auth-google" disabled={auth.busy} style={{ width: "100%", marginTop: 8 }} onClick={() => void auth.signInWithGoogle(tier)}>
                  Continue with Google
                </Button>
              </>
            )}
            <p id="auth-help" className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              This is a creator workspace. Your identity is never sent in content requests.
            </p>
          </form>
        </div>
      </div>
    </SkinScope>
  );
}
