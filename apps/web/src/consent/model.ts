// Consent + privacy model for the signup gate. GDPR-first: purposes are discrete, opt-in, and
// withdrawable; the Terms and Privacy acceptance is required to use the service, while analytics and
// demographics are separate optional consents (no bundling). Demographics are coarse, anonymized cohort
// features only (a gender category, an age band, a country, a macro market region) so a record never
// identifies a person. Identity is the session subject server-side (F1); nothing here puts a user id in a
// request body. No em dashes.

// Bump when the Privacy Policy or Terms change. A viewer whose stored consent predates this is re-asked.
// MUST match the policy-version meta in apps/web/public/legal/*.html.
export const POLICY_VERSION = "2026-06-15.1";

export const LEGAL = {
  privacyUrl: "/legal/privacy-policy.html",
  termsUrl: "/legal/terms.html",
} as const;

// The optional, separately-consented purposes. essential (the service itself) is implied by accepting the
// Terms and Privacy Policy and is not a toggle. biometric_face and product_placement are declared here so a
// consent record can carry them later, but they are gathered at the point of use (an explicit Article 9
// biometric consent for the face feature), not at signup.
export type PurposeKey =
  | "essential"
  | "analytics_personalization"
  | "demographics"
  | "biometric_face"
  | "product_placement";

export const OPTIONAL_PURPOSES: ReadonlyArray<{
  key: "analytics_personalization" | "demographics";
  label: string;
  detail: string;
}> = [
  {
    key: "analytics_personalization",
    label: "Personalized adaptive experience and analytics",
    detail:
      "Lets us re-cut the story to you and measure engagement to improve it. You can decline and still watch the standard cut.",
  },
  {
    key: "demographics",
    label: "Share anonymized demographics",
    detail:
      "A coarse gender, age band, and region. Stored anonymized and used only to improve recommendations for groups, never to identify you.",
  },
];

// ---------- anonymized demographic categories (coarse on purpose) ----------

export const GENDER_OPTIONS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "nonbinary", label: "Non-binary" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;
export type GenderValue = (typeof GENDER_OPTIONS)[number]["value"];

// Age BANDS, never a date of birth. Coarse buckets keep the data non-identifying.
export const AGE_BANDS = [
  { value: "13_17", label: "13 to 17" },
  { value: "18_24", label: "18 to 24" },
  { value: "25_34", label: "25 to 34" },
  { value: "35_44", label: "35 to 44" },
  { value: "45_54", label: "45 to 54" },
  { value: "55_plus", label: "55 or older" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;
export type AgeBandValue = (typeof AGE_BANDS)[number]["value"];

// A macro market region, not a precise location. Country stays coarse (a short list plus Other).
export const MARKET_REGIONS = [
  { value: "americas", label: "Americas" },
  { value: "emea", label: "Europe, Middle East, Africa" },
  { value: "apac", label: "Asia Pacific" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;
export type MarketRegionValue = (typeof MARKET_REGIONS)[number]["value"];

export const COUNTRIES = [
  "United States",
  "Canada",
  "Mexico",
  "United Kingdom",
  "Spain",
  "France",
  "Germany",
  "United Arab Emirates",
  "India",
  "Japan",
  "Brazil",
  "Other",
] as const;

export interface Demographics {
  gender?: GenderValue;
  ageBand?: AgeBandValue;
  country?: string;
  marketRegion?: MarketRegionValue;
}

export interface ConsentRecord {
  consentId: string;
  policyVersion: string;
  // Required to use the service. A single combined acceptance sets both (the Terms reference the Privacy
  // Policy), recorded explicitly so the record is auditable.
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
  // Separate optional consents, default false (opt-in).
  purposes: { analytics_personalization: boolean; demographics: boolean };
  // Present only when the demographics purpose is granted.
  demographics?: Demographics;
  recordedAt: string; // ISO 8601
  locale?: string;
}

export function newConsentId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback for environments without crypto.randomUUID. Not cryptographically strong, only a local id.
  return `c-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

// True when there is no valid acceptance for the CURRENT policy version, so the gate must be shown.
export function needsConsent(record: ConsentRecord | null): boolean {
  if (!record) return true;
  if (record.policyVersion !== POLICY_VERSION) return true;
  return !(record.acceptedTerms && record.acceptedPrivacy);
}
