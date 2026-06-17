// P12 engine-API credit metering. Each tenant has included credits and a hard cap; engine-API calls meter
// credits. recordUsage is idempotent by an idempotency key (a replayed metering event does not double
// count), and quotaCheck denies a call that would exceed the hard cap. No em dashes.

export type MeteredTenant = {
  tenantId: string;
  includedCredits: number;
  usedCredits: number;
  hardCap: number; // included + allowed overage; calls past this are denied
};

export function remaining(t: MeteredTenant): number {
  return Math.max(0, t.hardCap - t.usedCredits);
}

export type QuotaResult = { allowed: boolean; reason?: string };

export function quotaCheck(t: MeteredTenant, units: number): QuotaResult {
  if (!(units > 0)) return { allowed: false, reason: "units must be positive" };
  if (t.usedCredits + units > t.hardCap) {
    return { allowed: false, reason: `over hard cap (used ${t.usedCredits} + ${units} > ${t.hardCap})` };
  }
  return { allowed: true };
}

export type UsageResult = { tenant: MeteredTenant; charged: number; duplicate: boolean };

// Idempotent usage recording. seen is the set of idempotency keys already applied; a duplicate key is a
// no-op. A call that would exceed the cap throws (quotaCheck should gate before calling).
export function recordUsage(t: MeteredTenant, units: number, idempotencyKey: string, seen: Set<string>): UsageResult {
  if (seen.has(idempotencyKey)) return { tenant: t, charged: 0, duplicate: true };
  const q = quotaCheck(t, units);
  if (!q.allowed) throw new Error(`metering refused: ${q.reason}`);
  seen.add(idempotencyKey);
  return { tenant: { ...t, usedCredits: t.usedCredits + units }, charged: units, duplicate: false };
}

export function overageCredits(t: MeteredTenant): number {
  return Math.max(0, t.usedCredits - t.includedCredits);
}
