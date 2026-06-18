// The cuts catalog client: the premium-cut merchandising surface (20-V5 / 20-V6). It binds to the
// CUTS API CONTRACT, served by the catalog service (base from VITE_CATALOG_BASE_URL):
//
//   GET /series/:id/cuts -> [{ beatId, beatLabel, cuts:[{ variantId, kind, label, coinCost, isPremium }] }]
//
// These are the premium / alternate cuts per beat drawn from the variant substrate
// (mobile.beat_variants). The player marks the OWNED ones client-side using the economy /wallet
// entitlements ([{scope:'beat_variant', scope_id}]); this client never decides ownership. Identity
// rides the session bearer token through the shared apiFetch (F1: never a body field). The surface
// owns its own empty / loading / error states. No em dashes.

import { apiFetch } from "./http.js";
import type { SessionProvider } from "./session.js";

// The premium cut TYPES the substrate exposes for merchandising. master / dub / a11y / etc. exist on
// beat_variants.variant_kind, but the purchasable-cut surface merchandises exactly these three story
// cut types per the contract.
export type CutKind = "alt_ending" | "pov" | "intensity";

export interface SeriesCut {
  // The beat_variants row id this cut maps to. This is the scope_id used for the economy /spend and for
  // matching against the wallet beat_variant entitlements (own-once).
  variantId: string;
  kind: CutKind;
  // Human label, e.g. "His POV" or "Alternate ending".
  label: string;
  // Price in credits. Server-derived; the spend ledger enforces it. The UI never invents a price.
  coinCost: number;
  isPremium: boolean;
}

export interface BeatCuts {
  beatId: string;
  beatLabel: string;
  cuts: SeriesCut[];
}

const KIND_VALUES: readonly CutKind[] = ["alt_ending", "pov", "intensity"];

function isCutKind(value: unknown): value is CutKind {
  return typeof value === "string" && (KIND_VALUES as readonly string[]).includes(value);
}

export interface CutsClient {
  // The premium / alternate cuts per beat for this series. Returns [] when the series has none, so the
  // surfaces render an explicit empty state rather than a dead end.
  getSeriesCuts(seriesId: string): Promise<BeatCuts[]>;
}

export interface CutsClientOptions {
  baseUrl: string;
  session: SessionProvider;
  fetch?: typeof globalThis.fetch;
}

export function createCutsClient(opts: CutsClientOptions): CutsClient {
  const { baseUrl, session } = opts;
  return {
    async getSeriesCuts(seriesId: string): Promise<BeatCuts[]> {
      const raw = await apiFetch<BeatCuts[] | { beats: BeatCuts[] }>(
        baseUrl,
        `/series/${encodeURIComponent(seriesId)}/cuts`,
        session,
        { fetch: opts.fetch },
      );
      const list = Array.isArray(raw) ? raw : (raw?.beats ?? []);
      // Normalize defensively so a sparse contract response still typechecks at the surface, and drop any
      // cut whose kind is outside the merchandised set so the sheet never renders an unpriceable row.
      return list.map((b) => ({
        beatId: b.beatId,
        beatLabel: b.beatLabel,
        cuts: (b.cuts ?? [])
          .filter((c) => isCutKind(c.kind))
          .map((c) => ({
            variantId: c.variantId,
            kind: c.kind,
            label: c.label,
            coinCost: typeof c.coinCost === "number" ? c.coinCost : 0,
            isPremium: c.isPremium ?? true,
          })),
      }));
    },
  };
}

// Display copy for each merchandised cut type. The sheet leads with these so the offer is transparent
// (anti-dark-pattern: the viewer always knows exactly what a cut is before buying).
export const CUT_KIND_COPY: Record<CutKind, { title: string; blurb: string }> = {
  alt_ending: {
    title: "Alternate ending",
    blurb: "See how this story really lands. A different ending for this beat.",
  },
  pov: {
    title: "His / Her POV",
    blurb: "The same scene from the other side. The moment, their point of view.",
  },
  intensity: {
    title: "Intensity+",
    blurb: "A darker, sharper cut of this beat. Higher stakes, harder edges.",
  },
};
