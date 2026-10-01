// One place that builds the network clients for the app, all sharing the same token provider (Bearer
// when signed in, nothing when signed out), plus the signed playback url cache. No em dashes.

import { randomUUID } from "expo-crypto";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { createEventsClient, type EventsClient } from "../core/analytics/events";
import { createContentClient, type ContentClient } from "../core/api/content";
import { createMockContentClient } from "../core/api/mocks";
import { createTipsClient, type TipsClient } from "../core/economy/tips";
import { PlaybackUrlCache } from "../core/player/playbackUrl";
import { env, useMocks } from "./env";
import { usePrefs } from "./PrefsProvider";
import { currentAccessToken } from "./supabase";

export interface Services {
  content: ContentClient;
  tips: TipsClient;
  events: EventsClient;
  playbackCache: PlaybackUrlCache;
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ children }: { children: ReactNode }) {
  const { analyticsAllowedNow } = usePrefs();
  const services = useMemo<Services>(() => {
    const http = { getAccessToken: currentAccessToken };
    return {
      content: useMocks ? createMockContentClient() : createContentClient(env.contentBaseUrl, http),
      tips: createTipsClient(env.economyBaseUrl, { ...http, newId: randomUUID }),
      events: createEventsClient(env.eventsBaseUrl, { ...http, isAllowed: analyticsAllowedNow, newId: randomUUID }),
      playbackCache: new PlaybackUrlCache(),
    };
  }, [analyticsAllowedNow]);
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const v = useContext(ServicesContext);
  if (!v) throw new Error("useServices outside ServicesProvider");
  return v;
}
