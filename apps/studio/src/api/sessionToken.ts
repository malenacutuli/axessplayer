// The single source of the creator's bearer token for every studio API client. Production: the signed-in
// creator's live Supabase access token (null when signed out). A fixed VITE_CREATOR_SESSION_TOKEN is honoured
// ONLY in a dev build (local stacks running the test verifier), so a production bundle never ships a shared
// identity. Tests can replace the provider. No em dashes.
import { getStudioSupabase, isDevBuild } from "../auth/supabase.js";

type TokenProvider = () => Promise<string | null>;

function devToken(): string | null {
  if (!isDevBuild()) return null;
  try {
    const env = import.meta.env as unknown as Record<string, string | undefined>;
    return env.VITE_CREATOR_SESSION_TOKEN?.trim() || env.VITE_SESSION_TOKEN?.trim() || null;
  } catch {
    return null;
  }
}

const supabaseToken: TokenProvider = async () => {
  const client = getStudioSupabase();
  if (!client) return devToken();
  try {
    const { data } = await client.auth.getSession();
    return data.session?.access_token ?? devToken();
  } catch {
    return null;
  }
};

let provider: TokenProvider = supabaseToken;

export function setStudioTokenProvider(next: TokenProvider | null): void {
  provider = next ?? supabaseToken;
}

export function studioToken(): Promise<string | null> {
  return provider();
}

export async function studioAuthHeader(): Promise<Record<string, string>> {
  const token = await studioToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

// Wrap a fetch so every request carries the creator's bearer (unless the call set its own authorization).
// Headers stay a plain object, so callers and tests that read init.headers keep working.
export function withStudioAuth(fetchImpl: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const auth = await studioAuthHeader();
    const given = (init.headers ?? {}) as Record<string, string>;
    const hasAuth = Object.keys(given).some((k) => k.toLowerCase() === "authorization");
    return fetchImpl(input, hasAuth || !auth.authorization ? init : { ...init, headers: { ...given, ...auth } });
  }) as typeof fetch;
}
