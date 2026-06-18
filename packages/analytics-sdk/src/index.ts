// Public entry point for @axessplayer/analytics-sdk.
// Re-export the canonical event taxonomy and emit interface. No em dashes by project rule.

export type {
  AxpEventName,
  AxpEventProps,
  AxpEvent,
  AxpEventInput,
  AxpEventEmitter,
} from "./events.js";
export { AXP_EVENT_NAMES, isAxpEventName } from "./events.js";

export type { FetchLike, EmitClientConfig } from "./emit.js";
export { HttpEmitClient, createEmitClient } from "./emit.js";
