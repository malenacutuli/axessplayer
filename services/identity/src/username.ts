// Username (handle) validation. Pure, no IO, so it is unit-testable and shared by both the live
// availability check (GET /profile/username-available) and the profile write (POST /profile). The rules
// are slug rules: lowercase letters, digits, and single internal underscores, 3..30 chars, must start and
// end with an alphanumeric. Availability against the database is a separate concern; this only judges the
// shape. No em dashes.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

// Slug rule: starts alphanumeric, then letters/digits with optional single underscores between, ends
// alphanumeric. No leading/trailing/double underscores, no uppercase, no other punctuation.
const USERNAME_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export type UsernameError =
  | "empty"
  | "too_short"
  | "too_long"
  | "invalid_chars";

export interface UsernameValidation {
  ok: boolean;
  // The canonical (lowercased, trimmed) form used for storage and the case-insensitive uniqueness check.
  normalized: string;
  error?: UsernameError;
}

// Normalize a candidate handle to its canonical comparison form: trim surrounding whitespace and lowercase.
// The case-insensitive availability check and storage both key on this form.
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

// Validate the SHAPE of a username. Returns the normalized form plus a specific error code on failure so
// the route can return a precise 400. Length is measured on the normalized form.
export function validateUsername(raw: unknown): UsernameValidation {
  if (typeof raw !== "string") return { ok: false, normalized: "", error: "empty" };
  const normalized = normalizeUsername(raw);
  if (normalized.length === 0) return { ok: false, normalized, error: "empty" };
  if (normalized.length < USERNAME_MIN) return { ok: false, normalized, error: "too_short" };
  if (normalized.length > USERNAME_MAX) return { ok: false, normalized, error: "too_long" };
  if (!USERNAME_RE.test(normalized)) return { ok: false, normalized, error: "invalid_chars" };
  return { ok: true, normalized };
}

export function isValidUsername(raw: unknown): boolean {
  return validateUsername(raw).ok;
}
