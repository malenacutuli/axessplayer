// The production session provider reads the live Supabase token; the rewards client sends it on every
// reward call (the server credits the session subject, not a body userId). No em dashes.
import { describe, it, expect } from "vitest";
import { supabaseSession, staticSession } from "./session.js";
import { createRewardsClient } from "./rewards.js";

const client = (token: string | null) => ({
  auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) },
});

describe("supabaseSession", () => {
  it("returns the live access token when signed in", async () => {
    expect(await supabaseSession(() => client("jwt-abc")).getToken()).toBe("jwt-abc");
  });
  it("returns null when signed out, unconfigured, or when the SDK throws", async () => {
    expect(await supabaseSession(() => client(null)).getToken()).toBeNull();
    expect(await supabaseSession(() => null).getToken()).toBeNull();
    const broken = { auth: { getSession: async () => { throw new Error("storage blocked"); } } };
    expect(await supabaseSession(() => broken).getToken()).toBeNull();
  });
});

describe("rewards client", () => {
  it("sends the session bearer on reward calls", async () => {
    const seen: Array<Record<string, string>> = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return new Response(JSON.stringify({ granted: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const rewards = createRewardsClient({ fetch: fetchFn, session: staticSession("jwt-abc") });
    await rewards.checkin("ignored-by-server");
    expect(seen[0].authorization).toBe("Bearer jwt-abc");
  });
});
