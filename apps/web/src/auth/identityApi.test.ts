// Tests for the identity client + auth analytics. They lock the wire shape against services/identity and
// the graceful "backend not ready" degradation, and confirm picks emit the canonical channel_followed
// event. No network: a stub fetch is injected. No em dashes.

import { describe, it, expect } from "vitest";
import { createIdentityClient, IdentityError } from "./identityApi.js";
import { createAuthAnalytics } from "./authAnalytics.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("identity client", () => {
  it("sends the access token as a bearer to /auth/verify and parses the profile", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const fetchStub: typeof globalThis.fetch = async (url, init) => {
      seen = {
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
      };
      return jsonResponse(200, {
        user: { id: "u1", email: "a@b.c", username: null, avatar_url: null, tier: "free" },
        profile_complete: false,
      });
    };
    const client = createIdentityClient({ baseUrl: "/identity", fetch: fetchStub });
    const res = await client.verify("supabase:auth-1:a@b.c");
    expect(res.profile_complete).toBe(false);
    expect(seen!.url).toBe("/identity/auth/verify");
    expect(seen!.auth).toBe("Bearer supabase:auth-1:a@b.c");
  });

  it("reports username availability with a reason, never throwing on an ill-shaped name", async () => {
    const fetchStub: typeof globalThis.fetch = async () =>
      jsonResponse(200, { available: false, reason: "too_short" });
    const client = createIdentityClient({ baseUrl: "/identity", fetch: fetchStub });
    const res = await client.usernameAvailable("ab");
    expect(res.available).toBe(false);
    expect(res.reason).toBe("too_short");
  });

  it("never puts a user_id in the create-profile body (F1)", async () => {
    let body: unknown;
    const fetchStub: typeof globalThis.fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return jsonResponse(200, {
        user: { id: "u1", email: "a@b.c", username: "neo", avatar_url: null, tier: "free" },
        profile_complete: true,
      });
    };
    const client = createIdentityClient({ baseUrl: "/identity", fetch: fetchStub });
    await client.createProfile("tok", { username: "neo", picks: [{ channelId: "ch_drama" }] });
    expect(Object.keys(body as Record<string, unknown>)).not.toContain("user_id");
    expect((body as { username: string }).username).toBe("neo");
  });

  it("degrades a network failure to a typed backend_unreachable error", async () => {
    const fetchStub: typeof globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const client = createIdentityClient({ baseUrl: "/identity", fetch: fetchStub });
    await expect(client.me("tok")).rejects.toMatchObject({
      name: "IdentityError",
      status: 0,
      code: "backend_unreachable",
    });
  });

  it("maps a non-2xx error body to a typed IdentityError code", async () => {
    const fetchStub: typeof globalThis.fetch = async () => jsonResponse(409, { error: "username_taken" });
    const client = createIdentityClient({ baseUrl: "/identity", fetch: fetchStub });
    const err = await client.createProfile("tok", { username: "neo" }).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityError);
    expect((err as IdentityError).code).toBe("username_taken");
  });
});

describe("auth analytics", () => {
  it("emits the canonical channel_followed event through a wired emitter", () => {
    const emitted: Array<{ name: string; props?: Record<string, unknown> }> = [];
    const analytics = createAuthAnalytics({
      emitter: { emit: (e) => emitted.push(e) },
    });
    analytics.channelFollowed("ch_drama");
    expect(emitted).toHaveLength(1);
    expect(emitted[0].name).toBe("channel_followed");
    expect(emitted[0].props?.channel_id).toBe("ch_drama");
  });

  it("routes lifecycle breadcrumbs to the injected sink without personal data", () => {
    const crumbs: string[] = [];
    const analytics = createAuthAnalytics({ onBreadcrumb: (c) => crumbs.push(c.step) });
    analytics.breadcrumb({ step: "sign_in_prompt_shown" });
    analytics.breadcrumb({ step: "auth_verified" });
    expect(crumbs).toEqual(["sign_in_prompt_shown", "auth_verified"]);
  });
});
