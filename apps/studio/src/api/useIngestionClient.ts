// React context for the ingestion job client so panels and tests share one configurable instance. Tests
// inject a client backed by a stub fetch; production builds one from the resolved base URL. Mirrors
// useContentClient so the two services are wired the same way. No em dashes.
import { createContext, useContext } from "react";
import { IngestionClient } from "./ingestion.js";

export const IngestionClientContext = createContext<IngestionClient | null>(null);

export function useIngestionClient(): IngestionClient {
  const client = useContext(IngestionClientContext);
  if (!client) {
    throw new Error("useIngestionClient must be used within an IngestionClientContext provider");
  }
  return client;
}
