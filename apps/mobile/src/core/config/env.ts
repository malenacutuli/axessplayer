// Runtime configuration resolved from EXPO_PUBLIC_* variables. Expo inlines EXPO_PUBLIC_* only for
// STATIC member reads (process.env.EXPO_PUBLIC_X), so readExpoEnv() spells each one out. resolveConfig
// is pure and tested: empty values fall back to the production defaults, trailing slashes are trimmed,
// and the Supabase anon key has NO default (it is read from env only; without it the app is guest-only).
// No em dashes.

export interface AppEnv {
  contentBaseUrl: string;
  economyBaseUrl: string;
  eventsBaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export interface RawEnv {
  EXPO_PUBLIC_CONTENT_BASE_URL?: string;
  EXPO_PUBLIC_ECONOMY_BASE_URL?: string;
  EXPO_PUBLIC_EVENTS_BASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
}

export const DEFAULTS = {
  contentBaseUrl: "https://axessplayer-content.onrender.com",
  economyBaseUrl: "https://axessplayer-economy.onrender.com",
  eventsBaseUrl: "https://axessplayer-events.onrender.com",
  supabaseUrl: "https://faeyekynudyzeotbjfsj.supabase.co",
} as const;

export function trimTrailingSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

function pick(value: string | undefined, fallback: string): string {
  const v = (value ?? "").trim();
  return trimTrailingSlash(v.length > 0 ? v : fallback);
}

export function resolveConfig(raw: RawEnv): AppEnv {
  return {
    contentBaseUrl: pick(raw.EXPO_PUBLIC_CONTENT_BASE_URL, DEFAULTS.contentBaseUrl),
    economyBaseUrl: pick(raw.EXPO_PUBLIC_ECONOMY_BASE_URL, DEFAULTS.economyBaseUrl),
    eventsBaseUrl: pick(raw.EXPO_PUBLIC_EVENTS_BASE_URL, DEFAULTS.eventsBaseUrl),
    supabaseUrl: pick(raw.EXPO_PUBLIC_SUPABASE_URL, DEFAULTS.supabaseUrl),
    supabaseAnonKey: (raw.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").trim(),
  };
}

// True when sign-in can work at all. Without an anon key the account surfaces explain that sign-in is
// not configured in this build and the app stays guest-only.
export function authConfigured(env: AppEnv): boolean {
  return env.supabaseUrl.length > 0 && env.supabaseAnonKey.length > 0;
}

// Static reads so Expo's babel transform inlines the values at build time.
export function readExpoEnv(): RawEnv {
  return {
    EXPO_PUBLIC_CONTENT_BASE_URL: process.env.EXPO_PUBLIC_CONTENT_BASE_URL,
    EXPO_PUBLIC_ECONOMY_BASE_URL: process.env.EXPO_PUBLIC_ECONOMY_BASE_URL,
    EXPO_PUBLIC_EVENTS_BASE_URL: process.env.EXPO_PUBLIC_EVENTS_BASE_URL,
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  };
}
