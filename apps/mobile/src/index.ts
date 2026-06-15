// Public surface of the consumer mobile app. Re-exports the configurable network layer, the feed / player
// / wallet logic, the accessibility selection, and the screen components, so the Expo entry point (and
// the tests) wire them together from one import. The native entry (App.tsx / expo-router) is added at EAS
// build time and is out of this CI lane. No em dashes.

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

// screens
export { FeedScreen } from "./screens/FeedScreen.js";
export { PlayerScreen } from "./screens/PlayerScreen.js";
export { PaywallSheet } from "./screens/PaywallSheet.js";
export { WalletScreen } from "./screens/WalletScreen.js";
