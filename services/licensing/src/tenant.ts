// P12 tenant provisioning. A white-label tenant is provisioned with a plan, runs while active, and can be
// suspended (idempotent). Engine-API access and metering key off the tenant id. No em dashes.

export type TenantStatus = "provisioning" | "active" | "suspended";
export type Plan = "trial" | "standard" | "enterprise";

export type Tenant = {
  id: string;
  name: string;
  plan: Plan;
  status: TenantStatus;
};

export function provision(id: string, name: string, plan: Plan): Tenant {
  if (!id || !name) throw new Error("tenant requires an id and a name");
  return { id, name, plan, status: "active" };
}

// Idempotent transitions: suspending an already-suspended tenant is a no-op, and reactivating restores it.
export function suspend(t: Tenant): Tenant {
  return t.status === "suspended" ? t : { ...t, status: "suspended" };
}

export function reactivate(t: Tenant): Tenant {
  return t.status === "active" ? t : { ...t, status: "active" };
}

export function isOperational(t: Tenant): boolean {
  return t.status === "active";
}
