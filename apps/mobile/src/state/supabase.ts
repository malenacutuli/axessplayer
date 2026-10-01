// Supabase Auth client (email + password) with the session persisted in AsyncStorage. Created only when
// the anon key is configured; otherwise the app is guest-only and sign-in surfaces say so. The anon key is
// public by design (row level security protects data), but it is still read from env, never committed.
// No em dashes.

import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

import { canSignIn, env } from "./env";

export const supabase: SupabaseClient | null = canSignIn
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

// Refresh tokens only while the app is in the foreground (Supabase guidance for React Native).
if (supabase && Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

// The current access token, or null when signed out. getSession refreshes an expired token first.
export async function currentAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
