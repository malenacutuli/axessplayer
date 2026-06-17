// P7-T4 sovereign data-residency routing. The compliance moat is EU/Swiss data residency: a viewer's
// content plane and their consent + provenance records stay in the EU/Swiss region by default. This is the
// routing FLAG the serving plane reads; the actual multi-region deployment is infra. No em dashes.

export type Region = "eu-central" | "ch" | "us";

// Sovereign default: when in doubt, keep data in the EU. Personalized content and consent never leave the
// sovereign region without an explicit non-sovereign opt-in (not built here).
export const SOVEREIGN_DEFAULT: Region = "eu-central";

// ISO-3166 alpha-2 country -> data residency region. EU/EEA stays eu-central, Switzerland stays ch,
// everything else also defaults to the sovereign EU region (fail-sovereign) until a region exists for it.
const EU_EEA = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT",
  "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO",
]);

export function dataResidencyRegion(viewerCountry?: string): Region {
  const cc = (viewerCountry ?? "").toUpperCase();
  if (cc === "CH") return "ch";
  if (EU_EEA.has(cc)) return "eu-central";
  return SOVEREIGN_DEFAULT; // fail-sovereign
}

// True when the chosen serving region keeps the viewer's data in an EU/Swiss sovereign region.
export function isSovereign(region: Region): boolean {
  return region === "eu-central" || region === "ch";
}
