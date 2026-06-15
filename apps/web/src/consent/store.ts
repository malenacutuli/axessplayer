// Consent persistence. Local-first so the gate works before any consent service exists. The remote seam
// (submitConsent) is the cutover point: when a consent endpoint is provisioned, the same record is posted
// server-side, where it is appended to the hash-chained consent_ledger keyed by the SESSION subject (never
// a user id in the body, per F1). Until then it is a best-effort no-op and the local record is the source
// of truth for the running app. No em dashes.

import type { ConsentRecord } from "./model.js";

export interface ConsentStore {
  load(): ConsentRecord | null;
  save(record: ConsentRecord): void;
  clear(): void;
}

const STORAGE_KEY = "axp.consent.v1";

export function createLocalConsentStore(storage?: Storage): ConsentStore {
  // Resolve lazily so a missing window (SSR) does not throw at import time.
  const resolve = (): Storage | null => storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  return {
    load() {
      const s = resolve();
      if (!s) return null;
      const raw = s.getItem(STORAGE_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as ConsentRecord;
      } catch {
        return null;
      }
    },
    save(record) {
      resolve()?.setItem(STORAGE_KEY, JSON.stringify(record));
    },
    clear() {
      resolve()?.removeItem(STORAGE_KEY);
    },
  };
}

let memoDefault: ConsentStore | null = null;
export function getDefaultConsentStore(): ConsentStore {
  if (!memoDefault) memoDefault = createLocalConsentStore();
  return memoDefault;
}

export interface ConsentSubmitResult {
  persisted: boolean;
  reason?: string;
}

// Best-effort server record of the consent. No-ops cleanly when no consent endpoint is configured (the
// cutover gate). Never throws to the UI: a failed remote write must not block someone from watching, and
// the local record remains authoritative until the endpoint exists.
export async function submitConsent(
  record: ConsentRecord,
  opts: { baseUrl?: string; fetch?: typeof globalThis.fetch } = {},
): Promise<ConsentSubmitResult> {
  const baseUrl = opts.baseUrl ?? readConsentBaseUrl();
  if (!baseUrl) return { persisted: false, reason: "no consent endpoint configured (cutover gate)" };
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  try {
    // Identity is the session subject server-side; the body carries the consent record only, never a user
    // id (F1). The session bearer is attached by the platform fetch in a later wiring pass.
    const res = await doFetch(`${baseUrl.replace(/\/$/, "")}/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
    });
    return { persisted: res.ok, reason: res.ok ? undefined : `http_${res.status}` };
  } catch (err) {
    return { persisted: false, reason: err instanceof Error ? err.message : "request_failed" };
  }
}

function readConsentBaseUrl(): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_CONSENT_BASE_URL || undefined;
}
