// Assembles the typed clients from config + session. One place builds the content, economy, and
// player transport against the configured base urls. The app and the tests both build clients this
// way, so the wiring under test is the wiring that ships. No em dashes.

import { loadConfig, type AppConfig } from "./config.js";
import { createContentClient, type ContentClient } from "./api/content.js";
import { createEconomyClient, type EconomyClient } from "./api/economy.js";
import { createRewardsClient, type RewardsClient } from "./api/rewards.js";
import { createWebTransport } from "./player/webTransport.js";
import type { SessionProvider } from "./api/session.js";
import type { Transport } from "@axessplayer/player-sdk";

export interface Clients {
  config: AppConfig;
  content: ContentClient;
  economy: EconomyClient;
  // Server-side reward callbacks (rewarded ad, check-in, follow). The browser never mints coins.
  rewards: RewardsClient;
  // Builds a fresh player transport for one viewing session.
  playerTransport(onStripUserId?: (id: string) => void): Transport;
}

export interface BuildClientsOptions {
  session: SessionProvider;
  config?: AppConfig;
  fetch?: typeof globalThis.fetch;
}

export function buildClients(opts: BuildClientsOptions): Clients {
  const config = opts.config ?? loadConfig();
  return {
    config,
    content: createContentClient({
      baseUrl: config.contentBaseUrl,
      session: opts.session,
      fetch: opts.fetch,
    }),
    economy: createEconomyClient({
      baseUrl: config.economyBaseUrl,
      session: opts.session,
      fetch: opts.fetch,
    }),
    // Same-origin via the Vite proxy: /reward/* to the settlement service, /admin/* to content.
    rewards: createRewardsClient({
      rewardsBaseUrl: config.economyBaseUrl,
      contentBaseUrl: config.contentBaseUrl,
      fetch: opts.fetch,
    }),
    playerTransport: (onStripUserId) =>
      createWebTransport({
        decisionBaseUrl: config.decisionBaseUrl,
        manifestBaseUrl: config.manifestBaseUrl,
        session: opts.session,
        fetch: opts.fetch,
        onStripUserId,
      }),
  };
}
