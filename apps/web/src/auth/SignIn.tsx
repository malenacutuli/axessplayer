// Sign in screen (20-V0, INTERACTION_MAP "Auth"). Three paths, all via Supabase Auth:
//   - Continue with Apple / Continue with Google (OAuth redirect),
//   - email magic link (passwordless OTP link), or
//   - email + password.
// On a successful Supabase session the AuthProvider's onAuthStateChange fires, POSTs the access token to
// identity /auth/verify, and the gate/flow advances. When auth is not configured (no Supabase env) this
// renders a graceful "backend not ready" empty state. WCAG AA: labelled fields, visible focus, live error
// region. No personal data leaves the device beyond the Supabase sign-in itself. No em dashes.

import { useState } from "react";
import { Button, Wordmark } from "@axessplayer/ui";
import { getSupabase, isAuthConfigured } from "./supabaseClient.js";
import type { AuthAnalytics } from "./authAnalytics.js";

type Mode = "choose" | "email_link" | "email_password";

export interface SignInProps {
  analytics: AuthAnalytics;
  // Optional dismiss affordance (the prompt sheet shows it; a full-screen route may not).
  onDismiss?: () => void;
}

export function SignIn({ analytics, onDismiss }: SignInProps): JSX.Element {
  const configured = isAuthConfigured();
  const [mode, setMode] = useState<Mode>("choose");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!configured) {
    return (
      <div className="auth-scr" data-testid="signin">
        <div className="auth-head">
          <Wordmark />
          <h1 className="auth-title">Sign in is not ready yet</h1>
          <p className="auth-sub">
            Authentication is not configured in this environment. You can keep browsing the feed. Wallet,
            purchases, downloads, and saving will be available once auth is connected.
          </p>
        </div>
        {onDismiss ? (
          <div className="auth-actions">
            <Button variant="secondary" onClick={onDismiss}>
              Keep browsing
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  async function oauth(provider: "apple" | "google") {
    const supabase = getSupabase();
    if (!supabase) return;
    setError(null);
    setBusy(true);
    analytics.breadcrumb({ step: "sign_in_started", method: provider });
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      });
      if (err) {
        setError("We could not start that sign in. Please try again.");
        analytics.breadcrumb({ step: "auth_failed", method: provider, reason: "oauth_start_failed" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    const supabase = getSupabase();
    if (!supabase) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    analytics.breadcrumb({ step: "sign_in_started", method: "email_magic_link" });
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (err) {
        setError("We could not send that link. Check the address and try again.");
        analytics.breadcrumb({ step: "auth_failed", method: "email_magic_link", reason: "otp_failed" });
      } else {
        setNotice("Check your email for a sign in link.");
        analytics.breadcrumb({ step: "magic_link_sent", method: "email_magic_link" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function signInPassword(e: React.FormEvent) {
    e.preventDefault();
    const supabase = getSupabase();
    if (!supabase) return;
    setError(null);
    setBusy(true);
    analytics.breadcrumb({ step: "sign_in_started", method: "email_password" });
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) {
        setError("That email or password did not match. Please try again.");
        analytics.breadcrumb({ step: "auth_failed", method: "email_password", reason: "bad_credentials" });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-scr" data-testid="signin">
      <div className="auth-head">
        <Wordmark />
        <h1 className="auth-title">Sign in to continue</h1>
        <p className="auth-sub">
          Browsing is open to everyone. Sign in to use your wallet, buy and unlock cuts, download for
          offline, save to your library, and manage your data.
        </p>
      </div>

      <div className="auth-providers">
        <button
          type="button"
          className="auth-provider-btn"
          onClick={() => void oauth("apple")}
          disabled={busy}
        >
          Continue with Apple
        </button>
        <button
          type="button"
          className="auth-provider-btn"
          onClick={() => void oauth("google")}
          disabled={busy}
        >
          Continue with Google
        </button>
      </div>

      <div className="auth-divider">or</div>

      {mode === "choose" ? (
        <div className="auth-providers">
          <button type="button" className="auth-provider-btn" onClick={() => setMode("email_link")}>
            Email me a sign in link
          </button>
          <button type="button" className="auth-provider-btn" onClick={() => setMode("email_password")}>
            Sign in with a password
          </button>
        </div>
      ) : null}

      {mode === "email_link" ? (
        <form className="auth-field" onSubmit={sendMagicLink} noValidate>
          <label className="auth-label" htmlFor="auth-email">
            Email address
          </label>
          <input
            id="auth-email"
            className="auth-input"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div className="auth-actions">
            <Button type="submit" disabled={busy || email.length === 0}>
              {busy ? "Sending." : "Send link"}
            </Button>
            <button type="button" className="auth-linkbtn" onClick={() => setMode("choose")}>
              Back
            </button>
          </div>
        </form>
      ) : null}

      {mode === "email_password" ? (
        <form className="auth-field" onSubmit={signInPassword} noValidate>
          <label className="auth-label" htmlFor="auth-email-pw">
            Email address
          </label>
          <input
            id="auth-email-pw"
            className="auth-input"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label className="auth-label" htmlFor="auth-pw">
            Password
          </label>
          <input
            id="auth-pw"
            className="auth-input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="auth-actions">
            <Button type="submit" disabled={busy || email.length === 0 || password.length === 0}>
              {busy ? "Signing in." : "Sign in"}
            </Button>
            <button type="button" className="auth-linkbtn" onClick={() => setMode("choose")}>
              Back
            </button>
          </div>
        </form>
      ) : null}

      <p className="auth-hint" role="status" aria-live="polite">
        {notice ?? ""}
      </p>
      <p className="auth-hint auth-hint--error" role="alert" aria-live="assertive">
        {error ?? ""}
      </p>

      {onDismiss ? (
        <button type="button" className="auth-linkbtn" onClick={onDismiss}>
          Not now
        </button>
      ) : null}
    </div>
  );
}
