// The auth state machine for the consumer app (20-V0, C12 boundary). It owns:
//
//   - the Supabase session (restored across reload via persistSession), exposed as the access token;
//   - the Axessplayer profile resolved from POST /auth/verify (and whether it is complete);
//   - the imperative "require auth" gate: a control that needs auth (wallet, purchase, download, consent,
//     save) calls requireAuth(); if signed out, a reusable SignInPrompt opens, the action is remembered,
//     and on success the original intent resumes.
//
// Browsing the feed needs NO auth. Only the gated actions prompt. Identity is the bearer token, never a
// body field (F1). No personal data is held beyond the email Supabase already returns. No em dashes.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getSupabase, isAuthConfigured } from "./supabaseClient.js";
import {
  createIdentityClient,
  IdentityError,
  type IdentityClient,
  type IdentityUser,
} from "./identityApi.js";
import { createAuthAnalytics, type AuthAnalytics, type CanonicalEmitter } from "./authAnalytics.js";
import { loadConfig } from "../config.js";

// Phase of the auth lifecycle. "ready" means the session check has settled (signed in or anonymous).
export type AuthPhase = "initializing" | "ready";

export interface AuthState {
  configured: boolean;
  phase: AuthPhase;
  // The current Supabase access token, or null when anonymous. Use for identity bearer calls.
  accessToken: string | null;
  // The resolved Axessplayer profile, or null when anonymous / not yet verified.
  user: IdentityUser | null;
  // Whether the profile has a username (drives the Create profile step).
  profileComplete: boolean;
  // True while a sign-in / verify round trip is in flight.
  busy: boolean;
  // A coarse, non-personal error code from the last auth operation, if any.
  error: string | null;
}

export interface AuthApi extends AuthState {
  identity: IdentityClient;
  analytics: AuthAnalytics;
  // Open the reusable sign-in prompt for a gated action; resolves true once the viewer is authenticated,
  // false if they dismiss. Anonymous-friendly surfaces call this at first use of a gated control.
  requireAuth(reason?: string): Promise<boolean>;
  // Whether the sign-in prompt is currently open, and its dismiss/handlers (consumed by the prompt UI).
  promptOpen: boolean;
  promptReason: string | null;
  closePrompt(authed: boolean): void;
  // Sign out: clears the Supabase session and local profile.
  signOut(): Promise<void>;
  // Re-run the access-token -> profile exchange (after a profile create, or to refresh completeness).
  refreshProfile(): Promise<void>;
  // Mark the profile complete locally after a successful POST /profile (avoids a redundant round trip).
  setProfile(user: IdentityUser, complete: boolean): void;
}

const Ctx = createContext<AuthApi | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
  // Optional canonical analytics emitter; channel_followed flows through it when present.
  emitter?: CanonicalEmitter;
  // Injectable identity client for tests; defaults to the configured base url.
  identity?: IdentityClient;
}

export function AuthProvider({ children, emitter, identity }: AuthProviderProps): JSX.Element {
  const configured = isAuthConfigured();
  const identityClient = useMemo<IdentityClient>(
    () => identity ?? createIdentityClient({ baseUrl: loadConfig().identityBaseUrl }),
    [identity],
  );
  const analytics = useMemo(() => createAuthAnalytics({ emitter }), [emitter]);

  const [state, setState] = useState<AuthState>({
    configured,
    phase: configured ? "initializing" : "ready",
    accessToken: null,
    user: null,
    profileComplete: false,
    busy: false,
    error: null,
  });

  const [promptOpen, setPromptOpen] = useState(false);
  const [promptReason, setPromptReason] = useState<string | null>(null);
  // A pending requireAuth() promise resolver, settled when the prompt closes or auth completes.
  const pendingResolve = useRef<((authed: boolean) => void) | null>(null);

  // Exchange a Supabase access token for the Axessplayer profile. Degrades to a typed error state when the
  // identity backend is not ready (e2e-PENDING the hosted tables), never throwing to the UI.
  const verifyToken = useCallback(
    async (accessToken: string) => {
      try {
        const res = await identityClient.verify(accessToken);
        setState((s) => ({
          ...s,
          accessToken,
          user: res.user,
          profileComplete: res.profile_complete,
          error: null,
        }));
        analytics.breadcrumb({ step: "auth_verified" });
      } catch (err) {
        const code = err instanceof IdentityError ? err.code : "verify_failed";
        // Keep the token (the viewer IS signed in with Supabase) but surface that profile linking is not
        // ready yet, so the UI can show "backend not ready" rather than a crash.
        setState((s) => ({ ...s, accessToken, error: code }));
        analytics.breadcrumb({ step: "auth_failed", reason: code });
      }
    },
    [identityClient, analytics],
  );

  // On mount: restore any persisted Supabase session, then subscribe to auth changes. When auth is not
  // configured we settle to "ready" anonymous so the feed still browses.
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setState((s) => ({ ...s, phase: "ready" }));
      return;
    }
    let live = true;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!live) return;
      if (token) await verifyToken(token);
      setState((s) => ({ ...s, phase: "ready" }));
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      const token = session?.access_token ?? null;
      if (!token) {
        setState((s) => ({ ...s, accessToken: null, user: null, profileComplete: false }));
        return;
      }
      void verifyToken(token);
    });
    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, [verifyToken]);

  // If a sign-in completes while a requireAuth() is pending, resolve it true and close the prompt.
  useEffect(() => {
    if (state.accessToken && pendingResolve.current) {
      pendingResolve.current(true);
      pendingResolve.current = null;
      setPromptOpen(false);
      setPromptReason(null);
    }
  }, [state.accessToken]);

  const requireAuth = useCallback(
    (reason?: string) => {
      if (state.accessToken) return Promise.resolve(true);
      analytics.breadcrumb({ step: "sign_in_prompt_shown", reason });
      setPromptReason(reason ?? null);
      setPromptOpen(true);
      return new Promise<boolean>((resolve) => {
        pendingResolve.current = resolve;
      });
    },
    [state.accessToken, analytics],
  );

  const closePrompt = useCallback((authed: boolean) => {
    setPromptOpen(false);
    setPromptReason(null);
    if (pendingResolve.current) {
      pendingResolve.current(authed);
      pendingResolve.current = null;
    }
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
    setState((s) => ({ ...s, accessToken: null, user: null, profileComplete: false, error: null }));
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!state.accessToken) return;
    await verifyToken(state.accessToken);
  }, [state.accessToken, verifyToken]);

  const setProfile = useCallback((user: IdentityUser, complete: boolean) => {
    setState((s) => ({ ...s, user, profileComplete: complete }));
  }, []);

  const api: AuthApi = {
    ...state,
    identity: identityClient,
    analytics,
    requireAuth,
    promptOpen,
    promptReason,
    closePrompt,
    signOut,
    refreshProfile,
    setProfile,
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

// Hook for any surface that needs auth state or the requireAuth gate. Throws if used outside the provider
// so the wiring mistake fails loud in tests.
export function useAuth(): AuthApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within an AuthProvider");
  return v;
}
