// Prompt 01 / T2: stable Control vs Treatment assignment.
// Deterministic 50/50 by a hash of the viewer id, so a viewer's arm is fixed across sessions, the
// split is reproducible, and it is logged on every impression. No em dashes.

export type Arm = "control" | "treatment";

// FNV-1a 32-bit, dependency-free and stable across runs/machines.
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Bump the salt to re-randomize the whole assignment (a fresh experiment).
export const ARM_SALT = "gatea-v1";

export function assignArm(viewerId: string, salt: string = ARM_SALT): Arm {
  // Use a high bit of the hash for the 50/50 split (low bits of FNV can be mildly patterned).
  return ((fnv1a(`${salt}:${viewerId}`) >>> 16) & 1) === 0 ? "control" : "treatment";
}
