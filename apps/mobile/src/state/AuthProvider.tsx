// Auth context: who is signed in (if anyone) and the sign-in / sign-up / sign-out actions. Guests can
// watch everything; signing in only unlocks tipping and the library. No em dashes.

import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { canSignIn } from "./env";
import { supabase } from "./supabase";

export interface AuthValue {
  ready: boolean;
  configured: boolean;
  session: Session | null;
  email: string | null;
  signIn(email: string, password: string): Promise<string | null>;
  signUp(email: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!supabase);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  // Each action resolves to an error message for the form, or null on success.
  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return "Sign-in is not configured in this build.";
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return error ? error.message : null;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    if (!supabase) return "Sign-in is not configured in this build.";
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) return error.message;
    return data.session ? null : "Check your email to confirm your account, then sign in.";
  }, []);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      configured: canSignIn,
      session,
      email: session?.user.email ?? null,
      signIn,
      signUp,
      signOut,
    }),
    [ready, session, signIn, signUp, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
