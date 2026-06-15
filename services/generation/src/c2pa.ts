// C2PA provenance manifest, emitted per produced variant. This is the CLEAR INTERFACE FOR W9 (trust):
// W8 produces a variant row and an unsigned manifest describing how that variant was made; W9 signs it and
// records it in content_credentials (manifest JSONB, tier, beat_variant_id). W8 does not write
// content_credentials itself; coordinate the provenance write with W9. The shape here is what W9 consumes.
//
// The signature field is intentionally left null by W8: signing is W9's job and requires the trust
// service's key material. W8 fills everything a signer needs and nothing it must not see. No em dashes.

import type { VariantKind, VariantTier } from "./spec.js";
import type { MediaArtifact } from "./backends.js";

// A single processing action, in the spirit of a C2PA assertion (c2pa.actions). Mocked tools in tests.
export interface C2paAction {
  action: string; // for example c2pa.created, c2pa.transcoded, c2pa.edited
  softwareAgent: string; // the generator id (mocked in tests)
  digitalSourceType: string; // IPTC term: trainedAlgorithmicMedia | digitalCapture | composite
}

// The unsigned manifest W8 emits. W9 wraps this, adds a signature and an issuer, and stores the result.
export interface C2paManifest {
  // The version of this manifest contract between W8 and W9.
  manifest_version: "1.0";
  // The variant this attests. beat_variant_id is filled once the row is inserted and its id is known.
  beat_variant_id: string;
  tier: VariantTier;
  variant_kind: VariantKind;
  // The content binding: a hash of the produced media. A swapped file breaks verification.
  content_hash: string;
  // The claim generator (W8 pipeline build id) and the per-asset generator (the media backend).
  claim_generator: string;
  asset_generator: string;
  // The ordered provenance actions.
  actions: C2paAction[];
  // Free-form ingredients / parents (for example the filmed spine segment a recut derives from).
  ingredients: Array<{ url: string; relationship: "parentOf" | "componentOf" }>;
  // Whether AI tooling materially produced the asset. Drives the AI-Act disclosure W9 surfaces.
  ai_generated: boolean;
  created_at: string; // ISO 8601, set by W8 at emit time
  // Left null by W8. W9 signs and fills it. Present in the type so the contract is explicit.
  signature: string | null;
}

// The W8 build id baked into every manifest. A real build stamps the commit / pipeline version here.
export const CLAIM_GENERATOR = "axessplayer-generation/0.1.0";

// Map a tier to the IPTC digitalSourceType used in the created action.
function sourceTypeForTier(tier: VariantTier): string {
  switch (tier) {
    case "A_filmed":
      return "digitalCapture";
    case "B_likeness":
      return "composite";
    case "C_ai":
      return "trainedAlgorithmicMedia";
  }
}

// Build the unsigned manifest for a produced variant. Pure: same inputs yield the same manifest (minus
// created_at, which the caller may pin for deterministic tests via the now arg).
export function buildManifest(args: {
  beatVariantId: string;
  tier: VariantTier;
  kind: VariantKind;
  artifact: MediaArtifact;
  source_url: string;
  now?: () => Date;
}): C2paManifest {
  const { beatVariantId, tier, kind, artifact, source_url } = args;
  const now = args.now ?? (() => new Date());
  const ai = tier === "B_likeness" || tier === "C_ai";

  const actions: C2paAction[] = [
    {
      action: "c2pa.created",
      softwareAgent: artifact.generator,
      digitalSourceType: sourceTypeForTier(tier),
    },
  ];
  for (const step of artifact.steps) {
    actions.push({
      action: step === "encode_hls" ? "c2pa.transcoded" : "c2pa.edited",
      softwareAgent: artifact.generator,
      digitalSourceType: sourceTypeForTier(tier),
    });
  }

  return {
    manifest_version: "1.0",
    beat_variant_id: beatVariantId,
    tier,
    variant_kind: kind,
    content_hash: artifact.content_hash,
    claim_generator: CLAIM_GENERATOR,
    asset_generator: artifact.generator,
    actions,
    ingredients: [{ url: source_url, relationship: "parentOf" }],
    ai_generated: ai,
    created_at: now().toISOString(),
    signature: null,
  };
}

// A produced variant paired with its manifest, the unit W8 hands to W9.
export interface SignedManifestHandoff {
  beat_variant_id: string;
  tier: VariantTier;
  manifest: C2paManifest;
}
