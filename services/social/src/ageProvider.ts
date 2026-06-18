// Production-shaped AgeProvider stub for the social service. The canonical age/DOB is owned by the
// identity/profile plane (services/identity). This service reads the viewer's age band by INTERFACE only;
// it never stores a birthdate.
//
// FLAGGED, NOT FAKED: the real wiring resolves the band from the identity plane (a verified-DOB lookup over
// HTTP). Until that is wired, this default provider returns "unknown" for every viewer, which the age-gate
// treats as a MINOR for mature content (fail-closed). It NEVER returns "adult" by default, so an unwired
// age plane cannot accidentally admit a viewer to a mature community. No em dashes.

import type { AgeProvider, ViewerAge } from "./ageGate.js";

// Default fail-closed provider: every viewer is "unknown" -> blocked from mature content. Replace with a
// real identity-plane-backed provider before mature communities go live.
export class FailClosedAgeProvider implements AgeProvider {
  async resolve(_userId: string): Promise<ViewerAge> {
    return { band: "unknown" };
  }
}
