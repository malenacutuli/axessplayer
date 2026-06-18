// Demand-rail ADAPTER interface. The brand rail LICENSES the programmatic demand and delivery rails
// (Magnite / SpringServe / GAM) and the SSAI/ABR variant selection through narrow adapter INTERFACES. We do
// NOT build the demand exchange, and we do NOT build computer-vision zone detection or viewer tracking:
// generation-time placement uses GROUND-TRUTH scene metadata (the structural advantage), so the adapter
// only chooses among already-eligible creatives and REPORTS delivery. No em dashes.

import type { FillCandidate, ViewerContext } from "./types.js";

// The license-not-build contract. select() ranks/filters eligible creatives the demand rail is willing to
// serve; report() hands delivery signals back to the rail for billing/measurement on THEIR side. Neither
// method does any vision work: candidates arrive already bound to ground-truth slot surfaces.
export interface DemandAdapter {
  readonly railName: string;
  readonly license: string; // the licensed integration, e.g. "magnite-streaming-ssp"
  // Choose among ALREADY-SAFE, ground-truth-bound candidates. Returns the chosen candidate or null when the
  // rail has no fill. Pure selection: no CV, no tracking. propensity is the rail's logged selection weight.
  select(
    candidates: FillCandidate[],
    viewer: ViewerContext,
  ): Promise<{ candidate: FillCandidate; propensity: number } | null>;
  // Report a delivered fill back to the demand rail (impression/completion). Returns the rail's ack id.
  report(event: { creativeRef: string; campaignId: string; region: string; signal: string }): Promise<{ ackId: string }>;
}

// Hard guard: a DemandAdapter must NOT smuggle a CV/zone-detection capability. The interface is delivery +
// selection only. This asserts an adapter exposes no vision/tracking method, so a reviewer (and a test) can
// prove the rail is licensed-not-built. Throws if a forbidden capability is present.
const FORBIDDEN_CAPABILITIES = [
  "detectZones",
  "reconstructScene",
  "trackViewer",
  "estimatePose",
  "segment",
  "computerVision",
] as const;

export function assertNoVisionCapability(adapter: DemandAdapter): void {
  const found = FORBIDDEN_CAPABILITIES.filter((c) => typeof (adapter as unknown as Record<string, unknown>)[c] === "function");
  if (found.length > 0) {
    throw new Error(`demand adapter ${adapter.railName} must be license-not-build: forbidden CV capability ${found.join(", ")}`);
  }
}

// Stub Magnite/GAM adapter. LICENSED interface, not a built exchange. It picks the first eligible candidate
// matching the viewer region (a real adapter would call the rail's decisioning API). Deterministic for
// tests. No CV, no tracking: it never inspects pixels and only reads the ground-truth-bound candidate list.
export function createStubDemandAdapter(railName = "magnite", license = "magnite-streaming-ssp"): DemandAdapter {
  return {
    railName,
    license,
    async select(candidates, viewer) {
      if (candidates.length === 0) return null;
      const regional = candidates.filter((c) => c.region === (viewer.country ? regionFor(viewer.country) : c.region));
      const pick = (regional.length > 0 ? regional : candidates)[0];
      // Uniform logged propensity over the considered set, for off-policy brand-match lift.
      const k = (regional.length > 0 ? regional : candidates).length;
      return { candidate: pick, propensity: 1 / k };
    },
    async report(event) {
      // A real adapter POSTs the rail's measurement endpoint. The stub returns a deterministic ack.
      return { ackId: `${railName}:${event.campaignId}:${event.creativeRef}` };
    },
  };
}

// SSAI/ABR variant selection is ALSO an adapter (license-not-build). Selects a region/bitrate variant for a
// chosen creative; no CV. Kept separate from the demand SSP adapter so each rail is swappable.
export interface SsaiAbrAdapter {
  readonly railName: string;
  readonly license: string;
  selectVariant(creativeRef: string, ctx: { region: string; bitrateHint?: number }): Promise<{ variantRef: string }>;
}

export function createStubSsaiAdapter(railName = "springserve", license = "springserve-ssai"): SsaiAbrAdapter {
  return {
    railName,
    license,
    async selectVariant(creativeRef, ctx) {
      return { variantRef: `${creativeRef}@${ctx.region}/${ctx.bitrateHint ?? 1080}` };
    },
  };
}

// Minimal country -> ad-region map (a real deployment maps to the rail's region taxonomy).
function regionFor(country: string): string {
  const c = country.toUpperCase();
  if (["US", "CA", "MX"].includes(c)) return "NA";
  if (["GB", "FR", "DE", "ES", "IT"].includes(c)) return "EU";
  return "GLOBAL";
}
