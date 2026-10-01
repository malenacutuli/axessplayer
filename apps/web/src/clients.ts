// Assembles the typed clients from config + session. One place builds the content, economy, and
// player transport against the configured base urls. The app and the tests both build clients this
// way, so the wiring under test is the wiring that ships. No em dashes.

import { loadConfig, type AppConfig } from "./config.js";
import { createContentClient, type ContentClient } from "./api/content.js";
import { createCatalogClient, type CatalogClient } from "./api/catalog.js";
import { createCutsClient, type CutsClient } from "./api/cuts.js";
import { createLibraryClient, type LibraryClient } from "./api/library.js";
import { createExperimentClient, type ExperimentClient } from "./api/experiment.js";
import { createEconomyClient, type EconomyClient } from "./api/economy.js";
import { createRewardsClient, type RewardsClient } from "./api/rewards.js";
import { createWebTransport } from "./player/webTransport.js";
import type { SessionProvider } from "./api/session.js";
import type { Transport } from "@axessplayer/player-sdk";

export interface Clients {
  config: AppConfig;
  content: ContentClient;
  // 20-V1 / 20-V3 catalog read + calibration surface (CATALOG API CONTRACT).
  catalog: CatalogClient;
  // 20-V5 / 20-V6 premium-cut merchandising read surface (CUTS API CONTRACT).
  cuts: CutsClient;
  // 20-V4 library: saved, favorites, downloads, history, channel-follows (LIBRARY API CONTRACT, authed).
  library: LibraryClient;
  // 25-D2 decision/experiment plane: per-viewer poster selection + impression/click logging.
  experiment: ExperimentClient;
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
    catalog: createCatalogClient({
      baseUrl: config.catalogBaseUrl,
      session: opts.session,
      fetch: opts.fetch,
    }),
    // The cuts catalog shares the catalog service origin (CUTS API CONTRACT, VITE_CATALOG_BASE_URL).
    cuts: createCutsClient({
      baseUrl: config.catalogBaseUrl,
      session: opts.session,
      fetch: opts.fetch,
    }),
    library: createLibraryClient({
      baseUrl: config.libraryBaseUrl,
      session: opts.session,
      fetch: opts.fetch,
    }),
    experiment: createExperimentClient({
      baseUrl: config.experimentBaseUrl,
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
      session: opts.session,
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
