// The UGC moderation pipeline for services/social. This is the safety spine of the highest-risk viewer
// surface (20-V8 social/community): EVERY user-generated write (a character post, a show comment) runs
// through this pipeline BEFORE it can be published. The pipeline is FAIL-CLOSED.
//
// FAIL-CLOSED CONTRACT (hard, non-negotiable):
//   * A write starts as 'pending'. It is NEVER readable by viewers until a scan returns a clean verdict.
//   * The scan calls an injected ScanProvider (CSAM / illegal content + harassment / abuse). A REAL
//     provider drops in here. With NO provider wired, the pipeline returns 'pending_provider' and the
//     content STAYS unpublished forever. There is no auto-clean default. The unwired path NEVER yields
//     'approved'. This is the opposite of fail-open: an absent/erroring scanner keeps content invisible.
//   * A 'block' verdict (the scanner found CSAM/illegal/harassment) -> 'rejected', never published.
//   * Only an explicit 'clean' verdict from a wired provider -> 'approved' (publishable).
//
// The pipeline owns NO storage and NO HTTP; it is a pure function over an injected ScanProvider so it is
// unit-testable and reusable by every write path. No em dashes.

// The publish state of a UGC row, mirrored by moderation_status in 14_social.sql.
//   pending          : queued, awaiting a scan verdict. Not visible.
//   pending_provider : no scan provider is wired (or it could not be reached). Not visible. Fail-closed.
//   approved         : a wired provider returned clean. Visible.
//   rejected         : a wired provider returned block (CSAM/illegal/harassment). Not visible, terminal.
export type ModerationStatus = "pending" | "pending_provider" | "approved" | "rejected";

// What the content is, so the scanner and the report/queue paths can key on it.
export type UgcKind = "post" | "comment";

// The verdict a ScanProvider returns for a piece of UGC.
//   clean : safe to publish.
//   block : CSAM / illegal / harassment / abuse detected. Must not publish.
export type ScanVerdict = "clean" | "block";

export interface ScanInput {
  kind: UgcKind;
  authorUserId: string;
  body: string;
  // Optional media reference (image/video) for the scanner. A real CSAM scan inspects media too.
  mediaUrl?: string | null;
}

export interface ScanResult {
  verdict: ScanVerdict;
  // Optional coded category for the moderation queue / audit ("csam", "illegal", "harassment", ...).
  category?: string;
}

// The pluggable content-safety provider. A real implementation calls an external CSAM/illegal-content and
// harassment classifier (e.g. a hash-match + ML pipeline) and returns a verdict. The interface is the
// ONLY coupling: the service never hard-codes a vendor.
export interface ScanProvider {
  scan(input: ScanInput): Promise<ScanResult>;
}

// The result of running the pipeline: the status to persist and an optional rejection category.
export interface PipelineOutcome {
  status: ModerationStatus;
  category?: string;
}

// Run the moderation pipeline for one UGC write. FAIL-CLOSED at every branch:
//   * provider == null            -> 'pending_provider' (unwired scanner; content stays unpublished).
//   * provider.scan throws/errors -> 'pending_provider' (could not scan; content stays unpublished).
//   * verdict 'block'             -> 'rejected'.
//   * verdict 'clean'             -> 'approved'.
// Note the only path to 'approved' is a wired provider that returned 'clean'. Nothing else publishes.
export async function runModeration(
  input: ScanInput,
  provider: ScanProvider | null,
): Promise<PipelineOutcome> {
  if (provider == null) {
    // No scanner wired. Fail-closed: the content is accepted into storage as pending_provider but is
    // NEVER readable until a real provider scans and approves it.
    return { status: "pending_provider" };
  }
  let result: ScanResult;
  try {
    result = await provider.scan(input);
  } catch {
    // A scanner error must not publish content. Fail-closed: treat an unreachable/erroring provider the
    // same as an unwired one.
    return { status: "pending_provider" };
  }
  if (result.verdict === "block") {
    return { status: "rejected", ...(result.category ? { category: result.category } : {}) };
  }
  if (result.verdict === "clean") {
    return { status: "approved" };
  }
  // An unrecognized verdict is treated as not-clean (fail-closed).
  return { status: "pending_provider" };
}

// Whether a status is publishable (viewer-visible). Only 'approved' is. Kept here so the store, the route,
// and tests share one definition and a forgotten branch cannot leak unscanned content.
export function isPublished(status: ModerationStatus): boolean {
  return status === "approved";
}
