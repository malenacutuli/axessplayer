// The studio's Supabase Auth client: one lazily created client per app load, configured from
// VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (public values). Session persistence and auto refresh are on, so a
// signed-in creator survives reload and the bearer stays valid. Returns null when not configured. No em dashes.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

function env(): Record<string, string | undefined> {
  try {
    return import.meta.env as unknown as Record<string, string | undefined>;
  } catch {
    return {};
  }
}

export function getStudioSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey } = env();
  cached = url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "axp-studio-auth" },
      })
    : null;
  return cached;
}

// Base URL of the identity service, which links a Supabase login to an Axessplayer profile (POST /auth/verify).
export function identityBaseUrl(): string {
  return (env().VITE_IDENTITY_BASE_URL ?? "").replace(/\/$/, "");
}

export function isDevBuild(): boolean {
  try {
    return (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
  } catch {
    return false;
  }
}
