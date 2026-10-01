// Unit tests for the caller checks. Run: deno test --no-config --allow-env --allow-net supabase/functions/_shared
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { requireService, requireUser } from "./auth.ts";

const cors = { "Access-Control-Allow-Origin": "*" };
const req = (auth?: string) => new Request("http://x/", { headers: auth ? { authorization: auth } : {} });

Deno.test("requireService: rejects missing, anon and wrong bearer; accepts the service key", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
  assertEquals(requireService(req(), cors)?.status, 401);
  assertEquals(requireService(req("Bearer anon-key"), cors)?.status, 401);
  assertEquals(requireService(req("Bearer service-ke"), cors)?.status, 401);
  assertEquals(requireService(req("Bearer service-key"), cors), null);
});

Deno.test("requireService: 500 when the service key is not configured", () => {
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  assertEquals(requireService(req("Bearer x"), cors)?.status, 500);
});

Deno.test("requireUser: anon key and missing token are rejected without a network call", async () => {
  Deno.env.set("SUPABASE_URL", "http://127.0.0.1:9");
  Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
  assertEquals(((await requireUser(req(), cors)) as Response).status, 401);
  assertEquals(((await requireUser(req("Bearer anon-key"), cors)) as Response).status, 401);
});

Deno.test("requireUser: accepts a token the auth server resolves to a user, rejects one it does not", async () => {
  const ac = new AbortController();
  const server = Deno.serve({ port: 0, signal: ac.signal, onListen() {} }, (r) =>
    r.headers.get("authorization") === "Bearer good"
      ? Response.json({ id: "user-1" })
      : new Response("{}", { status: 401 }));
  Deno.env.set("SUPABASE_URL", `http://127.0.0.1:${server.addr.port}`);
  assertEquals(await requireUser(req("Bearer good"), cors), { userId: "user-1" });
  assertEquals(((await requireUser(req("Bearer bad"), cors)) as Response).status, 401);
  ac.abort();
  await server.finished;
});
