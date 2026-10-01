// Caller checks for the axessplayer edge functions. The gateway (verify_jwt = true) only proves the bearer is a
// JWT signed by this project, and the public anon key is such a JWT. So every function must also decide WHO may
// call it:
//   requireService: backend-only functions (paid generation, stitch). Bearer must equal the service-role key.
//   requireUser:    browser-facing functions (uploads). Bearer must be a signed-in user's access token.
// Both return a ready 401/500 Response to send back, or the caller identity. No em dashes.

function bearer(req: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  return m ? m[1].trim() : null;
}

// Length-independent comparison so the check does not leak the key through timing.
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

function deny(status: number, error: string, cors: Record<string, string>): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export function requireService(req: Request, cors: Record<string, string>): Response | null {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return deny(500, "service key not configured", cors);
  const token = bearer(req);
  if (!token || !safeEqual(token, serviceKey)) return deny(401, "service credentials required", cors);
  return null;
}

export async function requireUser(req: Request, cors: Record<string, string>): Promise<{ userId: string } | Response> {
  const token = bearer(req);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return deny(500, "auth not configured", cors);
  if (!token || safeEqual(token, anon)) return deny(401, "sign in required", cors);
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    await res.body?.cancel();
    return deny(401, "sign in required", cors);
  }
  const user = (await res.json()) as { id?: string };
  if (!user.id) return deny(401, "sign in required", cors);
  return { userId: user.id };
}
