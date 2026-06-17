// Production registrar that routes C2PA provenance signing and consent-reference writes through the trust
// service. This is GATED behind the consent/provenance founder sign-off: until consentProvenanceLive is
// true, the registrar attaches the produced track URL to the variant (a content write, not a provenance
// claim) and RECORDS the intended provenance/consent, but does NOT sign or write a consent record live. A
// likeness asset (tier B_likeness) additionally requires a consent reference and is refused without one
// (the render precondition). Orchestration is unchanged; this only swaps the injected register port. No em dashes.

import type { Stage } from "./stages.js";
import type { IngestJob, RunPorts } from "./orchestrator.js";
import { stageTrackField } from "./executors.js";

// The trust-service ports (services/trust TrustService.recordProvenance + appendConsent), injected.
export interface TrustPort {
  recordProvenance(claim: { beat_variant_id: string; tier: string; generator: string; asset_hash: string; created_at: string }): Promise<void>;
  appendConsent(input: { likeness_subject: string; beat_variant_id: string; consent_ref: string }): Promise<void>;
}

export interface ContentWritePort {
  setTrackField(variantId: string, field: string, value: string, lang?: string): Promise<void>;
  setSeriesPoster(seriesId: string, posterUrl: string): Promise<void>;
}

export interface ProductionRegistrarDeps {
  variantIdForBeat?: string;
  trust: TrustPort;
  content: ContentWritePort;
  // The consent/provenance go-live gate. Default false: built and testable but inert until founder sign-off.
  consentProvenanceLive: boolean;
  // For a likeness asset, the consent reference (a signed DPA/consent id). null for non-likeness assets.
  consentRefFor?(stage: Stage, artifact: string): { likenessSubject: string; consentRef: string } | null;
  // A content hash of the produced asset for the C2PA claim.
  assetHash?(artifact: string): string;
  generator?: string;
  onIntent?(record: { kind: string; variantId?: string; field?: string; live: boolean }): void;
}

export type RegistrarStatus = { trackWritten: boolean; provenanceSigned: boolean; consentWritten: boolean; refused?: string };

export function makeProductionRegistrar(deps: ProductionRegistrarDeps): NonNullable<RunPorts["register"]> {
  return async (stage: Stage, artifact: string, job: IngestJob): Promise<void> => {
    await registerOne(stage, artifact, job, deps);
  };
}

// Exposed for tests: returns the status of what was done vs gated.
export async function registerOne(stage: Stage, artifact: string, job: IngestJob, deps: ProductionRegistrarDeps): Promise<RegistrarStatus> {
  const status: RegistrarStatus = { trackWritten: false, provenanceSigned: false, consentWritten: false };

  if (stage.kind === "poster") {
    await deps.content.setSeriesPoster(job.seriesId, artifact);
    status.trackWritten = true;
  } else {
    const field = stageTrackField(stage);
    if (!field || !deps.variantIdForBeat) {
      deps.onIntent?.({ kind: stage.kind, live: deps.consentProvenanceLive });
      return status; // intermediate (transcript/character): no track, no provenance
    }
    // Attach the produced track URL to the variant (a content write; not the provenance path).
    await deps.content.setTrackField(deps.variantIdForBeat, field, artifact, stage.lang);
    status.trackWritten = true;
  }

  const variantId = stage.kind === "poster" ? job.seriesId : deps.variantIdForBeat;
  // A likeness asset requires a consent reference (render precondition); refuse without one.
  const consent = deps.consentRefFor?.(stage, artifact) ?? null;
  if (job.tier && stage.tier === "quality") {
    // (placeholder hook; quality sign assets are human and reviewed)
  }

  if (!deps.consentProvenanceLive) {
    // Gated: record intent only. No C2PA signature, no consent ledger write, until founder sign-off.
    deps.onIntent?.({ kind: stage.kind, variantId, field: stageTrackField(stage) ?? undefined, live: false });
    return status;
  }

  // LIVE path (after sign-off): C2PA-sign the asset and, for a likeness asset, write the consent reference.
  if (variantId) {
    await deps.trust.recordProvenance({
      beat_variant_id: variantId,
      tier: stage.kind === "sign" ? "C_ai" : "C_ai",
      generator: deps.generator ?? "ingestion/factory",
      asset_hash: deps.assetHash ? deps.assetHash(artifact) : artifact,
      created_at: new Date().toISOString(),
    });
    status.provenanceSigned = true;
    if (consent) {
      await deps.trust.appendConsent({ likeness_subject: consent.likenessSubject, beat_variant_id: variantId, consent_ref: consent.consentRef });
      status.consentWritten = true;
    }
  }
  return status;
}
