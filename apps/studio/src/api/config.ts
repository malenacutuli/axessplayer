// Configurable content service base URL. Resolves from the Vite env (VITE_CONTENT_BASE_URL) with a local
// default, so the studio can point at the live content service per environment without a code change.
// Secrets never live here: this is a public base URL only. No em dashes.

const DEFAULT_CONTENT_BASE_URL = "http://localhost:8787";

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
