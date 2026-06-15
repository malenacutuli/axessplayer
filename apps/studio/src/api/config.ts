// Configurable content service base URL. Resolves from the Vite env (VITE_CONTENT_BASE_URL) with a
// SAME-ORIGIN default (empty string), so in dev the browser hits Vite which proxies the content route
// prefixes to the live content service (see vite.config.ts, mirroring apps/web). In a built deployment
// set VITE_CONTENT_BASE_URL to the live content origin. Secrets never live here: a public base URL only.
// No em dashes.

// Same origin: the dev proxy (and a co-deployed reverse proxy) route /series, /beats, etc. by prefix.
const DEFAULT_CONTENT_BASE_URL = "";

export function resolveContentBaseUrl(env?: Record<string, string | undefined>): string {
  const source = env ?? readImportMetaEnv();
  const fromEnv = source?.VITE_CONTENT_BASE_URL;
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_CONTENT_BASE_URL;
}

function readImportMetaEnv(): Record<string, string | undefined> | undefined {
  // import.meta.env exists under Vite/Vitest; guard for any non-Vite context.
  try {
    return import.meta.env as unknown as Record<string, string | undefined>;
  } catch {
    return undefined;
  }
}
