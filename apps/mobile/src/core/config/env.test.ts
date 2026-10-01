import { test } from "node:test";
import assert from "node:assert/strict";
import { authConfigured, DEFAULTS, resolveConfig } from "./env";

test("empty env falls back to production defaults and leaves the anon key empty", () => {
  const c = resolveConfig({});
  assert.equal(c.contentBaseUrl, DEFAULTS.contentBaseUrl);
  assert.equal(c.economyBaseUrl, DEFAULTS.economyBaseUrl);
  assert.equal(c.eventsBaseUrl, DEFAULTS.eventsBaseUrl);
  assert.equal(c.supabaseUrl, DEFAULTS.supabaseUrl);
  assert.equal(c.supabaseAnonKey, "");
  assert.equal(authConfigured(c), false);
});

test("explicit values win and trailing slashes are trimmed", () => {
  const c = resolveConfig({ EXPO_PUBLIC_CONTENT_BASE_URL: "http://localhost:4001/ ", EXPO_PUBLIC_SUPABASE_ANON_KEY: " anon " });
  assert.equal(c.contentBaseUrl, "http://localhost:4001");
  assert.equal(c.supabaseAnonKey, "anon");
  assert.equal(authConfigured(c), true);
});
