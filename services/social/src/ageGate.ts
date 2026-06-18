// Age-gate for the social/community surface (hard gate, prompt 20-V8). Minors are BLOCKED from mature
// communities. There is NO romantic/parasocial overlap modelled anywhere in this service: a character
// follow is a content-feed subscription, not a relationship.
//
// The viewer's age band comes from the identity/profile plane (interface only). This module is a pure
// classifier so the route and tests share one definition and the gate cannot be bypassed by a body field.
// Fail-closed: an unknown age band is treated as a minor for the purpose of mature content. No em dashes.

// The coarse age band the identity plane resolves for a session subject. We never store a birthdate here;
// the identity/profile plane owns that. "unknown" means the plane could not establish adulthood.
export type AgeBand = "minor" | "adult" | "unknown";

// The viewer age context the route passes to a gate check, resolved from the session subject by the
// injected AgeProvider (interface only).
export interface ViewerAge {
  band: AgeBand;
}

// Resolve a session subject's age band. A real implementation reads the verified age/DOB from the identity
// plane. Fail-closed: when it cannot establish adulthood it returns "unknown" (treated as a minor for
// mature content), never silently "adult".
export interface AgeProvider {
  resolve(userId: string): Promise<ViewerAge>;
}

// Whether a viewer may access mature community content. Only a confirmed adult may. A minor or an unknown
// band is blocked (fail-closed). Non-mature content is allowed for everyone.
export function mayAccessMature(age: ViewerAge): boolean {
  return age.band === "adult";
}

// The gate decision for a specific access attempt. mature is the maturity flag of the target community /
// post. Returns true when access is allowed.
export function passesAgeGate(age: ViewerAge, mature: boolean): boolean {
  if (!mature) return true;
  return mayAccessMature(age);
}
