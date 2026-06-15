// The switch DECISION at a branch point. Given the /decide response, what is buffered, and an
// estimated bandwidth, decide which cut to play and whether the switch is seamless. This is pure: no
// IO, no clock. The frame-accurate cut-over itself (decoder hand-off at the exact branch sample) is
// device work and is OUT OF SCOPE here; this function decides WHICH cut and asserts whether it could
// be seamless (it was buffered in time). Device seamlessness is flagged, not faked. No em dashes.
//
// Fallback ladder (brief design 3: degrade to a great fixed film, never to a spinner):
//   1. is_control            -> play the deterministic director's cut, no adaptive switch.
//   2. low bandwidth         -> stay on the safe default cut rather than risk a stall on a new cut.
//   3. chosen not buffered   -> the prefetch window was missed; fall back to the default cut.
//   4. otherwise             -> seamless switch to the chosen next_variant_id.

import type { PrefetchBuffer } from "./prefetch.js";
import type { DecideResponse, SwitchDecision, VariantId } from "./types.js";

export interface SwitchInputs {
  // The decision engine response for this branch point.
  decision: DecideResponse;
  // What is currently buffered and ready (the prefetch buffer from the boundary).
  buffer: PrefetchBuffer;
  // The deterministic cut to fall back to when the chosen cut is unsafe or not ready. In the runtime
  // this is the control / director's cut for the beat (always buffered as the safe floor). For
  // control viewers next_variant_id already IS the director's cut, so it doubles as the default.
  defaultVariantId: VariantId;
  // Estimated downlink in kbps. When below bandwidthFloorKbps the player refuses to switch to a new
  // cut and holds the safe default. Undefined means "unknown", which is treated as adequate.
  estimatedKbps?: number;
  // Floor below which we degrade to the default cut. Default 600 kbps (a low-SD floor).
  bandwidthFloorKbps?: number;
}

const DEFAULT_BANDWIDTH_FLOOR_KBPS = 600;

// Resolve the play decision for one branch point. Deterministic given its inputs.
export function decideSwitch(inputs: SwitchInputs): SwitchDecision {
  const { decision, buffer, defaultVariantId } = inputs;
  const floor = inputs.bandwidthFloorKbps ?? DEFAULT_BANDWIDTH_FLOOR_KBPS;
  const chosen = decision.next_variant_id;

  // 1. Control viewer: serve the deterministic cut the engine returned, no adaptive switch. It is
  // seamless when buffered (the runtime buffers the control cut as the safe floor).
  if (decision.is_control) {
    return { variantId: chosen, reason: "control", seamless: buffer.has(chosen) };
  }

  // 2. Low bandwidth: do not gamble a new cut against a stall. Hold the safe default.
  if (inputs.estimatedKbps !== undefined && inputs.estimatedKbps < floor) {
    return {
      variantId: defaultVariantId,
      reason: "fallback_low_bandwidth",
      seamless: buffer.has(defaultVariantId),
    };
  }

  // 3. Chosen cut missed its prefetch window: degrade to the default cut, never to a spinner.
  if (!buffer.has(chosen)) {
    return {
      variantId: defaultVariantId,
      reason: "fallback_not_buffered",
      seamless: buffer.has(defaultVariantId),
    };
  }

  // 4. Happy path: the chosen cut is buffered. Seamless switch.
  return { variantId: chosen, reason: "chosen", seamless: true };
}
