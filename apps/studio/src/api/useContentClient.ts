// React context for the content client so components and tests share one configurable instance. Tests
// inject a client backed by a stub fetch; production builds one from the resolved base URL. No em dashes.
import { createContext, useContext } from "react";
import { ContentClient } from "./client.js";

export const ContentClientContext = createContext<ContentClient | null>(null);

export function useContentClient(): ContentClient {
  const client = useContext(ContentClientContext);
  if (!client) {
    throw new Error("useContentClient must be used within a ContentClientContext provider");
  }
  return client;
}
