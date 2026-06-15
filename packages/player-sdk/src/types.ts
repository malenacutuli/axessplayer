// Public SDK types, bound to the generated contract codegen so a contract change is a typecheck
// failure here (the same discipline services/decision uses). The type-only imports are erased at
// emit. We consume contracts/api/decision.yaml (the /decide call) and contracts/api/manifest.yaml
// (the per-variant playlist fetch). No em dashes.

import type { operations as DecisionOps } from "../../../contracts/types/generated/decision.js";
import type { operations as ManifestOps } from "../../../contracts/types/generated/manifest.js";

// ---- decision contract aliases ----

// The body the player POSTs to /decide at a beat boundary.
export type DecideRequest = DecisionOps["decide"]["requestBody"]["content"]["application/json"];

// The 200 body: chosen next variant, top-k prefetch hints, control flag, policy version.
export type DecideResponse =
  DecisionOps["decide"]["responses"][200]["content"]["application/json"];

// The beat-level signals the player measures and feeds back to /decide on the next boundary.
export type BeatSignals = DecideRequest["signals"];

// ---- manifest contract aliases ----

// The path param the player resolves to GET /manifest/{variant_id}.m3u8 for chosen + each prefetch id.
export type ManifestPathParams =
  ManifestOps["getManifest"]["parameters"]["path"];

// A variant id is a uuid string in both contracts. We keep a nominal-free alias for readability.
export type VariantId = string;

// ---- buffered candidate ----

// One prefetched candidate cut: its variant id and the raw HLS playlist text the manifest service
// returned. In the real runtime this is fronted by a decoder that has parsed and pre-buffered the
// first segments. Here the playlist body stands in for "buffered and ready to switch to".
export interface BufferedVariant {
  readonly variantId: VariantId;
  readonly playlist: string;
  // Monotonic clock (ms) when the buffer became ready. Used only for cache eviction ordering.
  readonly bufferedAt: number;
}

// ---- switch decision ----

// Why the player switched to the cut it played at the branch point. "chosen" is the happy path
// (the decision engine's next_variant_id was buffered in time). The rest are the named fallbacks.
export type SwitchReason =
  | "chosen" // next_variant_id was prefetched and ready: seamless switch
  | "control" // is_control true: play the deterministic director's cut, no adaptive switch
  | "fallback_not_buffered" // chosen cut missed its prefetch window: degrade to the default cut
  | "fallback_low_bandwidth"; // estimated bandwidth below floor: stay on the safe default cut

// The resolved play decision at a single branch point.
export interface SwitchDecision {
  readonly variantId: VariantId;
  readonly reason: SwitchReason;
  // True only when the cut was already buffered when the branch point arrived (no stall possible).
  readonly seamless: boolean;
}
