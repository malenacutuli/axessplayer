// @axessplayer/monetization public surface. Pure logic above the frozen economy ledger: the bandit
// paywall, reward settlement, and Stripe-to-grant mapping. The actual /grant call and the live Stripe
// rail are fenced behind the money/ledger founder sign-off. No em dashes.
export * from "./grant.js";
export * from "./paywall.js";
export * from "./rewards.js";
export * from "./stripe.js";
