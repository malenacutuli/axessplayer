import { test } from "node:test";
import assert from "node:assert/strict";
import { analyticsAllowed, CONSENT_KEY, loadConsent, parseConsent, saveConsent, shouldPromptConsent, type KeyValueStore } from "./consent";

function memStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: async (k) => map.get(k) ?? null, setItem: async (k, v) => void map.set(k, v) };
}

test("default is unset: prompt shown, analytics OFF", async () => {
  const s = await loadConsent(memStore());
  assert.equal(s, "unset");
  assert.equal(shouldPromptConsent(s), true);
  assert.equal(analyticsAllowed(s), false);
});

test("only an explicit grant allows analytics, and it persists", async () => {
  const store = memStore();
  await saveConsent(store, "granted");
  assert.equal(store.map.get(CONSENT_KEY), "granted");
  const s = await loadConsent(store);
  assert.equal(analyticsAllowed(s), true);
  assert.equal(shouldPromptConsent(s), false);
  await saveConsent(store, "denied");
  assert.equal(analyticsAllowed(await loadConsent(store)), false);
});

test("garbage or storage failure reads as unset (no consent)", async () => {
  assert.equal(parseConsent("yes"), "unset");
  const broken: KeyValueStore = { getItem: async () => { throw new Error("x"); }, setItem: async () => {} };
  assert.equal(await loadConsent(broken), "unset");
});
