// Content-scan provider INTERFACE for the moderation surface. CSAM / illegal-content and harassment
// scanning is a real interface wired to a provider LATER. It is NEVER faked: an unwired scanner must not
// fabricate a "clean" or "blocked" verdict. The shipped default (UnwiredScanProvider) returns a single
// honest status: "pending_provider". The seam is built so a real provider (a hash-match CSAM service, a
// harassment classifier) drops in behind this interface without a shape change. No em dashes.
//
// HARD GATE: a verdict of "clean" or "blocked" may ONLY ever come from a real wired provider that actually
// inspected the content. Until one is wired, the only legal value is "pending_provider". This is the
// difference between "we have not scanned this yet" and "we scanned this and it is safe"; conflating the
// two is the dark pattern this interface exists to prevent.

// The verdict surface a scan provider may return. "pending_provider" is the unwired state (no real scan
// happened). "clean"/"flagged"/"blocked" are REAL verdicts that only a wired provider that inspected the
// content may emit. "error" is a provider failure (the content was not conclusively scanned).
export type ScanStatus = "pending_provider" | "clean" | "flagged" | "blocked" | "error";

// The kind of scan, so a single provider interface covers both the CSAM/illegal-content media path and the
// harassment/abuse text path. A real provider may implement one or both.
export type ScanKind = "csam" | "illegal_content" | "harassment" | "abuse";

export interface ScanResult {
  status: ScanStatus;
  // The categories the provider checked / matched. Empty in the unwired case (nothing was checked).
  categories: ScanKind[];
  // A human-readable note. For the unwired provider this states plainly that no scan occurred.
  note: string;
  // The provider identity that produced this result, for the audit trail. "unwired" until a real provider
  // is injected, so a reader can never mistake a pending result for a real provider's verdict.
  provider: string;
}

// The provider contract. A real CSAM/harassment provider implements scanText (harassment/abuse over a
// comment/post body) and scanMedia (CSAM/illegal-content over an asset reference). Both are async because
// a real provider is a network call.
export interface ScanProvider {
  readonly name: string;
  scanText(text: string): Promise<ScanResult>;
  scanMedia(mediaRef: string): Promise<ScanResult>;
}

// The pending-provider result every unwired scan returns. A frozen constant so the unwired path cannot be
// mutated into a fabricated verdict.
const PENDING_NOTE =
  "no content-scan provider is wired; this is NOT a clean or blocked verdict. A real CSAM/harassment provider must be injected before any verdict is produced";

function pending(): ScanResult {
  return {
    status: "pending_provider",
    // The unwired provider checked nothing, so it claims no categories. A real verdict (clean/flagged/
    // blocked) and the categories it checked may ONLY come from a wired provider that inspected the content.
    categories: [],
    note: PENDING_NOTE,
    provider: "unwired",
  };
}

// The default provider. ALWAYS returns "pending_provider"; it never inspects content and never fabricates a
// verdict. This is the only legal behavior until a real provider is injected. void the input so the unused
// parameter is explicit (the unwired provider deliberately ignores the content it is handed).
export class UnwiredScanProvider implements ScanProvider {
  readonly name = "unwired";

  async scanText(text: string): Promise<ScanResult> {
    void text;
    return pending();
  }

  async scanMedia(mediaRef: string): Promise<ScanResult> {
    void mediaRef;
    return pending();
  }
}

// The default singleton the moderation aggregate uses until a real provider is injected.
export const unwiredScanProvider = new UnwiredScanProvider();
