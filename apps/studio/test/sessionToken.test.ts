// Every studio API call carries the signed-in creator's bearer; signed out sends none; an explicit
// authorization header is never overwritten. No em dashes.
import { describe, it, expect, afterEach } from "vitest";
import { withStudioAuth, setStudioTokenProvider } from "../src/api/sessionToken.js";

const capture = () => {
  const seen: Array<Record<string, string>> = [];
  const f = (async (_u: RequestInfo | URL, init: RequestInit = {}) => {
    seen.push((init.headers ?? {}) as Record<string, string>);
    return new Response("{}");
  }) as typeof fetch;
  return { seen, f };
};

afterEach(() => setStudioTokenProvider(null));

describe("withStudioAuth", () => {
  it("adds the creator's bearer to every request", async () => {
    setStudioTokenProvider(async () => "jwt-creator");
    const { seen, f } = capture();
    await withStudioAuth(f)("/series", { method: "POST", headers: { accept: "application/json" } });
    expect(seen[0]).toEqual({ accept: "application/json", authorization: "Bearer jwt-creator" });
  });
  it("sends no bearer when signed out", async () => {
    setStudioTokenProvider(async () => null);
    const { seen, f } = capture();
    await withStudioAuth(f)("/series", { headers: { accept: "application/json" } });
    expect(seen[0]).toEqual({ accept: "application/json" });
  });
  it("never overwrites an explicit authorization header", async () => {
    setStudioTokenProvider(async () => "jwt-creator");
    const { seen, f } = capture();
    await withStudioAuth(f)("/x", { headers: { Authorization: "Bearer explicit" } });
    expect(seen[0]).toEqual({ Authorization: "Bearer explicit" });
  });
});
