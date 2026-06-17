// P12 engine-API keys. A tenant's API key is shown ONCE at issue; only its sha256 hash is stored, so a
// leaked store cannot reconstruct the key. Verification hashes the presented key and matches a non-revoked
// record. Revocation is idempotent. No em dashes.

import { createHash } from "node:crypto";

export type ApiKeyRecord = {
  keyId: string;
  tenantId: string;
  hash: string; // sha256 hex of the raw key
  prefix: string; // a short non-secret display prefix
  revoked: boolean;
};

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

// Issue a record for a raw key the caller generated (the raw key is never stored). The prefix is the first
// 12 chars (e.g. "axp_live_ab") for display, which is not secret.
export function issueApiKey(keyId: string, tenantId: string, rawKey: string): ApiKeyRecord {
  if (rawKey.length < 16) throw new Error("api key too short to be secure");
  return { keyId, tenantId, hash: hashApiKey(rawKey), prefix: rawKey.slice(0, 12), revoked: false };
}

// Verify a presented key against the records; returns the owning tenant id or null. A revoked record never
// matches. Constant-ish: hashing is fixed work regardless of input.
export function verifyApiKey(presentedKey: string, records: ApiKeyRecord[]): string | null {
  const h = hashApiKey(presentedKey);
  const match = records.find((r) => !r.revoked && r.hash === h);
  return match ? match.tenantId : null;
}

export function revoke(record: ApiKeyRecord): ApiKeyRecord {
  return record.revoked ? record : { ...record, revoked: true };
}
