// Configurable catalog service base URL + the session-authed creator token. Resolves from the Vite env
// (VITE_CATALOG_BASE_URL) with a SAME-ORIGIN default (empty string) so the dev proxy can forward the
// /series catalog routes by prefix (mirrors the content config). The token resolves from
// VITE_CREATOR_SESSION_TOKEN (a session:<uuid> token in dev); secrets never live here, only a public base
// URL and a dev session token. No em dashes.
import { isDevBuild } from "../auth/supabase.js";

const DEFAULT_CATALOG_BASE_URL = "";

export function resolveCatalogBaseUrl(env?: Record<string, string | undefined>): string {
  const source = env ?? readImportMetaEnv();
  const fromEnv = source?.VITE_CATALOG_BASE_URL;
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_CATALOG_BASE_URL;
}

// A fixed env token is a dev-build convenience only; production uses the creator's Supabase session.
export function resolveCreatorToken(env?: Record<string, string | undefined>): string | null {
  if (!env && !isDevBuild()) return null;
  const source = env ?? readImportMetaEnv();
  const fromEnv = source?.VITE_CREATOR_SESSION_TOKEN;
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

function readImportMetaEnv(): Record<string, string | undefined> | undefined {
  try {
    return import.meta.env as unknown as Record<string, string | undefined>;
  } catch {
    return undefined;
  }
}
