// Contract type aliases for the app, bound to the generated codegen so a contract change is a typecheck
// failure here (the same discipline packages/player-sdk/src/types.ts uses). The type-only imports are
// erased at emit. We consume economy.yaml (/wallet, /spend) and content.yaml (/series/{id}/graph).
// Decision + manifest types are owned by player-sdk and re-exported through it. No em dashes.

import type {
  components as EconomyComponents,
  operations as EconomyOps,
} from "../../../../contracts/types/generated/economy.js";
import type { operations as ContentOps } from "../../../../contracts/types/generated/content.js";

// ---- economy contract aliases ----

// GET /wallet 200 body: balance, bonus_balance, entitlements (and the server-stamped user_id, which is
// RESPONSE-only; we never echo it back in any request).
export type Wallet = EconomyComponents["schemas"]["Wallet"];
export type Entitlement = EconomyComponents["schemas"]["Entitlement"];

// The 402 body when a spend has insufficient funds: the paywall options the UI must present.
export type PaywallOptions = EconomyComponents["schemas"]["PaywallOptions"];
export type PaywallOption = PaywallOptions["options"][number]; // "buy" | "watch_ad" | "subscribe"

// POST /spend request body. CRITICAL F1: this type has scope, scope_id, client_txn_id and NO user_id.
// The codegen makes "user_id in this body" a compile error, which is the contract enforcing the trust
// boundary, not memory.
export type SpendRequest =
  EconomyOps["spend"]["requestBody"]["content"]["application/json"];

// POST /spend 200 body: the new balance and the entitlement granted.
export type SpendResult =
  EconomyOps["spend"]["responses"][200]["content"]["application/json"];

// ---- content contract aliases ----

// The path param for GET /series/{id}/graph. The 200 body is undefined in the frozen content contract
// (it documents the operation but not the graph schema), so the graph view model is defined locally in
// src/feed/graph.ts and parsed defensively from the response json.
export type SeriesGraphPathParams =
  ContentOps["getSeriesGraph"]["parameters"]["path"];
