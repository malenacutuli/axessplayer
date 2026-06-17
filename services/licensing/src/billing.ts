// P12 per-tenant billing REPORT from metered usage. A report only, never a charge: charging a tenant is a
// money-go-live action behind the payment rail (out of scope here). The plan base price and the per-credit
// overage rate are FLAGGED placeholders for the licensing pricing decision. No em dashes.

import { overageCredits, type MeteredTenant } from "./metering.js";
import type { Plan } from "./tenant.js";

// FLAGGED placeholders for the licensing pricing decision.
export const PLAN_BASE_USD: Record<Plan, number> = { trial: 0, standard: 499, enterprise: 2500 };
export const OVERAGE_USD_PER_CREDIT = 0.02;

export type Invoice = {
  tenantId: string;
  plan: Plan;
  baseUsd: number;
  includedCredits: number;
  usedCredits: number;
  overageCredits: number;
  overageUsd: number;
  totalUsd: number;
};

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function invoice(t: MeteredTenant, plan: Plan, opts: { overageRate?: number } = {}): Invoice {
  const rate = opts.overageRate ?? OVERAGE_USD_PER_CREDIT;
  const over = overageCredits(t);
  const baseUsd = PLAN_BASE_USD[plan];
  const overageUsd = round2(over * rate);
  return {
    tenantId: t.tenantId,
    plan,
    baseUsd,
    includedCredits: t.includedCredits,
    usedCredits: t.usedCredits,
    overageCredits: over,
    overageUsd,
    totalUsd: round2(baseUsd + overageUsd),
  };
}
