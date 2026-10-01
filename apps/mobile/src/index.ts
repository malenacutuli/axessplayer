// LEGACY v1 surface (series graph, /decide, wallet + paywall). Platform v2 (free, accessible-by-default)
// does not use it: the Expo app entry is expo-router (app/) over src/core and src/ui. Kept, with its
// tests, for the interactive-series work that may return. No em dashes.

// network + config
export { createApiClient, PaywallRequiredError, AuthRequiredError, assertNoForbiddenKeys } from "./api/client.js";
export type { ApiClient } from "./api/client.js";
export { singleOrigin, trimSlash } from "./api/config.js";
export type { AppConfig, ServiceBaseUrls, BearerProvider } from "./api/config.js";
export type {
  Wallet,
  Entitlement,
  PaywallOptions,
  PaywallOption,
  SpendRequest,
  SpendResult,
} from "./api/types.js";

// feed
export { loadFeed, toFeedItems } from "./feed/feed.js";
export type { FeedItem, FeedLoadResult } from "./feed/feed.js";
export { parseSeriesGraph } from "./feed/graph.js";
export type { SeriesGraph, EpisodeNode, BeatNode, VariantNode } from "./feed/graph.js";

// accessibility
export {
  defaultPreferences,
  selectVariant,
  scoreVariant,
  activeAccessibility,
} from "./accessibility/preferences.js";
export type {
  AccessibilityPreferences,
  ActiveAccessibility,
} from "./accessibility/preferences.js";

// player
export { PlayerSession, resolveBeatAccessibility, paywallGateForBeat, unlockGate } from "./player/controller.js";
export type { PlayerSessionOptions, NowPlaying, PaywallGate } from "./player/controller.js";
export { createPlayerTransport, bearerFetch } from "./player/transport.js";

// wallet
export {
  hasEntitlement,
  spendableCoins,
  unlock,
  optimisticUnlock,
  reconcileAfterSpend,
  newClientTxnId,
} from "./wallet/wallet.js";
export type { UnlockOutcome } from "./wallet/wallet.js";

