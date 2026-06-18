// React context for the catalog client so the Branch and Analytics sections (and tests) share one
// configurable instance. Tests inject a client backed by a stub fetch; production builds one from the
// resolved base URL + creator token. No em dashes.
import { createContext, useContext } from "react";
import { CatalogClient } from "./catalogClient.js";

export const CatalogClientContext = createContext<CatalogClient | null>(null);

export function useCatalogClient(): CatalogClient {
  const client = useContext(CatalogClientContext);
  if (!client) {
    throw new Error("useCatalogClient must be used within a CatalogClientContext provider");
  }
  return client;
}
