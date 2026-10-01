// Creator Studio auth + tiers shell (prompt 22, section 1). A dependency-free auth context that models a
// signed-in creator, their TIER (solo / agency / production), and a Simple-default / Pro mode toggle. This
// is the authoring-side identity shell; it is NOT a request body field (the content client never sends a
// user_id, F1). The shell is deliberately a stub: there is no creator-auth backend yet, so sign-in here is
// a local session that unlocks the studio surfaces. Agency multi-client switching and production multi-seat
// are coming-soon stubs surfaced through the tier, not real features. No em dashes.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getStudioSupabase, identityBaseUrl } from "./supabase.js";

export type CreatorTier = "solo" | "agency" | "production";
export type StudioMode = "simple" | "pro";

export interface CreatorTierInfo {
  id: CreatorTier;
  label: string;
  blurb: string;
  // Advanced multi-X capability that is not built yet (a coming-soon stub at this tier).
  comingSoon?: string;
}

export const CREATOR_TIERS: CreatorTierInfo[] = [
  { id: "solo", label: "Solo", blurb: "One creator, one channel. Everything you need to publish." },
  {
    id: "agency",
    label: "Agency",
    blurb: "Manage several creator channels from one workspace.",
    comingSoon: "Multi-client switching",
  },
  {
    id: "production",
    label: "Production",
    blurb: "A full team with seats, roles, and rights management.",
    comingSoon: "Multi-seat teams",
  },
];

export interface CreatorSession {
  name: string;
  tier: CreatorTier;
}

export interface CreatorAuthApi {
  session: CreatorSession | null;
  mode: StudioMode;
  // True when real Supabase sign-in is available (configured build).
  supabaseAuth: boolean;
  // "initializing" until a persisted session has been checked.
  phase: "initializing" | "ready";
  busy: boolean;
  error: string | null;
  // Notice for the creator (e.g. "check your email to confirm").
  notice: string | null;
  // Local sign-in: dev builds without Supabase, and tests.
  signIn: (session: CreatorSession) => void;
  signInWithPassword: (email: string, password: string, tier: CreatorTier) => Promise<void>;
  signUpWithPassword: (email: string, password: string, tier: CreatorTier) => Promise<void>;
  signInWithGoogle: (tier: CreatorTier) => Promise<void>;
  signOut: () => void;
  setMode: (mode: StudioMode) => void;
  setTier: (tier: CreatorTier) => void;
}

const CreatorAuthContext = createContext<CreatorAuthApi | null>(null);

export interface CreatorAuthProviderProps {
  children: React.ReactNode;
  // Tests inject an already-signed-in creator so they can render a surface without walking the auth shell.
  initialSession?: CreatorSession | null;
  initialMode?: StudioMode;
}

const TIER_KEY = "axp-studio-tier";
function storedTier(): CreatorTier {
  try {
    const t = localStorage.getItem(TIER_KEY);
    return t === "agency" || t === "production" ? t : "solo";
  } catch {
    return "solo";
  }
}
function storeTier(tier: CreatorTier): void {
  try {
    localStorage.setItem(TIER_KEY, tier);
  } catch {
    /* private mode: the tier stays session-only */
  }
}

// Link the Supabase login to the creator's profile. Returns the display name, or throws a readable error.
async function linkProfile(accessToken: string): Promise<string> {
  const res = await fetch(`${identityBaseUrl()}/auth/verify`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(res.status === 401 ? "Your sign-in could not be verified." : `Profile link failed (${res.status}).`);
  const body = (await res.json()) as { user?: { username?: string | null; email?: string | null } };
  return body.user?.username || body.user?.email || "Creator";
}

export function CreatorAuthProvider({
  children,
  initialSession = null,
  initialMode = "simple",
}: CreatorAuthProviderProps): JSX.Element {
  const supabase = initialSession ? null : getStudioSupabase();
  const [session, setSession] = useState<CreatorSession | null>(initialSession);
  // Simple is the default. Pro is an explicit opt-in that reveals advanced panels via data-pro-only.
  const [mode, setMode] = useState<StudioMode>(initialMode);
  const [phase, setPhase] = useState<"initializing" | "ready">(supabase ? "initializing" : "ready");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const adopt = useCallback(async (accessToken: string | null) => {
    if (!accessToken) {
      setSession(null);
      return;
    }
    try {
      const name = await linkProfile(accessToken);
      setSession({ name, tier: storedTier() });
      setError(null);
    } catch (e) {
      setSession(null);
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let live = true;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!live) return;
      await adopt(data.session?.access_token ?? null);
      if (live) setPhase("ready");
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((evt, s) => {
      if (evt === "SIGNED_IN" || evt === "SIGNED_OUT" || evt === "USER_UPDATED") void adopt(s?.access_token ?? null);
    });
    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase, adopt]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, []);

  const signIn = useCallback((next: CreatorSession) => setSession(next), []);
  const signInWithPassword = useCallback(
    (email: string, password: string, tier: CreatorTier) =>
      run(async () => {
        if (!supabase) throw new Error("Sign-in is not configured.");
        storeTier(tier);
        const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw new Error(err.message);
        await adopt(data.session?.access_token ?? null);
      }),
    [supabase, run, adopt],
  );
  const signUpWithPassword = useCallback(
    (email: string, password: string, tier: CreatorTier) =>
      run(async () => {
        if (!supabase) throw new Error("Sign-up is not configured.");
        storeTier(tier);
        const { data, error: err } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (err) throw new Error(err.message);
        if (data.session) await adopt(data.session.access_token);
        else setNotice("Check your email to confirm your account, then sign in.");
      }),
    [supabase, run, adopt],
  );
  const signInWithGoogle = useCallback(
    (tier: CreatorTier) =>
      run(async () => {
        if (!supabase) throw new Error("Sign-in is not configured.");
        storeTier(tier);
        const { error: err } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
        if (err) throw new Error(err.message);
      }),
    [supabase, run],
  );
  const signOut = useCallback(() => {
    setSession(null);
    if (supabase) void supabase.auth.signOut();
  }, [supabase]);
  const setTier = useCallback((tier: CreatorTier) => {
    storeTier(tier);
    setSession((s) => (s ? { ...s, tier } : s));
  }, []);

  const api = useMemo<CreatorAuthApi>(
    () => ({
      session,
      mode,
      supabaseAuth: supabase != null,
      phase,
      busy,
      error,
      notice,
      signIn,
      signInWithPassword,
      signUpWithPassword,
      signInWithGoogle,
      signOut,
      setMode,
      setTier,
    }),
    [session, mode, supabase, phase, busy, error, notice, signIn, signInWithPassword, signUpWithPassword, signInWithGoogle, signOut, setTier],
  );

  return <CreatorAuthContext.Provider value={api}>{children}</CreatorAuthContext.Provider>;
}

export function useCreatorAuth(): CreatorAuthApi {
  const ctx = useContext(CreatorAuthContext);
  if (!ctx) throw new Error("useCreatorAuth must be used within a CreatorAuthProvider");
  return ctx;
}

export function tierInfo(tier: CreatorTier): CreatorTierInfo {
  return CREATOR_TIERS.find((t) => t.id === tier) ?? CREATOR_TIERS[0];
}
