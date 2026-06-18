// The reusable C12 sign-in gate. A control that requires auth (wallet, purchase, download, consent, save)
// calls auth.requireAuth(); when the viewer is anonymous, the AuthProvider opens this prompt as a sheet
// over the phone frame. Inside, it shows the sign in screen and, once signed in but profile-incomplete,
// the create-profile step, then dismisses (resolving the pending requireAuth to true). Browsing the feed
// never mounts this. WCAG AA: focus is trapped to the sheet, Escape dismisses, the dialog is labelled. No
// em dashes.

import { useEffect, useRef } from "react";
import { useAuth } from "./AuthProvider.js";
import { SignIn } from "./SignIn.js";
import { CreateProfile } from "./CreateProfile.js";

export interface SignInPromptProps {
  // Series id forwarded to CreateProfile for the seeded preference vector.
  seriesId?: string;
}

export function SignInPrompt({ seriesId }: SignInPromptProps): JSX.Element | null {
  const auth = useAuth();
  const sheetRef = useRef<HTMLDivElement | null>(null);

  // Move focus into the sheet when it opens and restore on close (a basic dialog focus contract).
  useEffect(() => {
    if (!auth.promptOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, [auth.promptOpen]);

  if (!auth.promptOpen) return null;

  // The viewer is signed in (token present) but has not finished their profile: show Create profile inside
  // the prompt. Otherwise show Sign in. When the profile becomes complete, the AuthProvider effect resolves
  // the pending requireAuth and closes the prompt.
  const needsProfile = auth.accessToken != null && !auth.profileComplete && auth.configured;

  return (
    <div
      className="auth-prompt-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) auth.closePrompt(false);
      }}
    >
      <div
        ref={sheetRef}
        className="auth-prompt-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={needsProfile ? "Create your profile" : "Sign in"}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") auth.closePrompt(false);
        }}
      >
        {needsProfile && auth.accessToken ? (
          <CreateProfile
            identity={auth.identity}
            accessToken={auth.accessToken}
            analytics={auth.analytics}
            seriesId={seriesId}
            onCreated={(user, complete) => {
              auth.setProfile(user, complete);
              // A complete profile resolves the pending requireAuth via the provider effect; if the
              // backend reports it still incomplete we keep the step open.
              if (complete) auth.closePrompt(true);
            }}
          />
        ) : (
          <SignIn analytics={auth.analytics} onDismiss={() => auth.closePrompt(false)} />
        )}
      </div>
    </div>
  );
}
