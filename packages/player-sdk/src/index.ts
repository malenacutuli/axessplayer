// @axessplayer/player-sdk public surface. The branching runtime: predictive prefetch + the seamless
// switch DECISION at a branch point, drivable deterministically (W12 end-to-end acceptance). The
// device-level frame-accurate cut-over and the real media stack (hls.js web, ExoPlayer/AVPlayer
// native) wire a Transport into this; they are W5's later on-hardware phase. No em dashes.

export { BranchingPlayer } from "./player.js";
export type { PlayerOptions, BranchStep } from "./player.js";

export { PrefetchBuffer, prefetchPlan } from "./prefetch.js";
export type { PrefetchOptions, PrefetchResult } from "./prefetch.js";

export { decideSwitch } from "./switch.js";
export type { SwitchInputs } from "./switch.js";

export {
  createHttpTransport,
  NoSuccessorsError,
  VariantNotFoundError,
} from "./transport.js";
export type { Transport, HttpTransportOptions } from "./transport.js";

export type {
  DecideRequest,
  DecideResponse,
  BeatSignals,
  BufferedVariant,
  SwitchDecision,
  SwitchReason,
  VariantId,
} from "./types.js";
