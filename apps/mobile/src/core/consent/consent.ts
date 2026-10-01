// Analytics consent gate. Default OFF: nothing is sent until the viewer explicitly accepts. "unset" means
// the first-launch prompt has not been answered yet (still treated as no consent). The decision is
// persisted through an injected key-value store (AsyncStorage in the app, a Map in tests) under a
// versioned key, so changing what we collect later can re-ask by bumping the version. No em dashes.

export type ConsentState = "unset" | "granted" | "denied";

export const CONSENT_KEY = "axessplayer.consent.analytics.v1";

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function parseConsent(raw: string | null | undefined): ConsentState {
  return raw === "granted" || raw === "denied" ? raw : "unset";
}

export function analyticsAllowed(state: ConsentState): boolean {
  return state === "granted";
}

export function shouldPromptConsent(state: ConsentState): boolean {
  return state === "unset";
}

export async function loadConsent(store: KeyValueStore): Promise<ConsentState> {
  try {
    return parseConsent(await store.getItem(CONSENT_KEY));
  } catch {
    return "unset";
  }
}

export async function saveConsent(store: KeyValueStore, state: Exclude<ConsentState, "unset">): Promise<void> {
  await store.setItem(CONSENT_KEY, state);
}
