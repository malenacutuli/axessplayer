// The session carries identity. F1 trust boundary: the acting user is ALWAYS the authenticated
// session subject, never a value in a request body. The web client attaches the session token as a
// bearer header on every call and NEVER puts a user_id in a body. In production the token comes from
// Supabase auth; here it is a pluggable provider so tests and the live app share one code path.
// No em dashes.

export interface SessionProvider {
  // Returns the current bearer token, or null when signed out. Async to allow a refresh.
  getToken(): Promise<string | null>;
}

// A static-token provider for tests and a first-touch demo session. Production swaps in a Supabase
// provider that returns the live access token.
export function staticSession(token: string | null): SessionProvider {
  return { getToken: async () => token };
}

// Builds the Authorization header for a request, or an empty object when signed out. This is the only
// place identity is attached to a request, by design.
export async function authHeader(session: SessionProvider): Promise<Record<string, string>> {
  const token = await session.getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}
