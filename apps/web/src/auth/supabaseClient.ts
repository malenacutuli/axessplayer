// The browser Supabase Auth client (20-V0). One lazily created client per app load, configured from
// VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY. Session persistence + auto refresh is ON, so a signed-in
// viewer survives reload (the C12 boundary restores from the persisted session). When the project is not
// configured (missing env), getSupabase() returns null and the auth UI shows a graceful "backend not
// ready" state rather than crashing. This is the ONLY place the Supabase SDK is constructed. No em dashes.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "../config.js";

let cached: SupabaseClient | null | undefined;

// Returns the singleton Supabase client, or null when the project is not configured. Null is a normal,
// handled state (the sign-in screen renders "auth not configured"), never a thrown error.
export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const cfg = supabaseConfig();
  if (!cfg) {
    cached = null;
    return null;
  }
  cached = createClient(cfg.url, cfg.anonKey, {
    auth: {
      // Persist + restore the session across reloads (C12: a signed-in viewer stays signed in), and refresh
      // the access token in the background so the bearer stays valid for identity calls.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "axp-auth",
    },
  });
  return cached;
}

// Whether a Supabase Auth project is configured for this build. The UI uses this to decide between the
// real sign-in controls and the "backend not ready" empty state.
export function isAuthConfigured(): boolean {
  return supabaseConfig() != null;
}
