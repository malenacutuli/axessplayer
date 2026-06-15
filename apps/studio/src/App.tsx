// App root: build the content client from the configurable base URL and provide it to the tree. No em
// dashes.
import { useMemo } from "react";
import { ContentClient } from "./api/client.js";
import { ContentClientContext } from "./api/useContentClient.js";
import { resolveContentBaseUrl } from "./api/config.js";
import { StudioPage } from "./components/StudioPage.js";

export function App(): JSX.Element {
  const client = useMemo(() => new ContentClient({ baseUrl: resolveContentBaseUrl() }), []);
  return (
    <ContentClientContext.Provider value={client}>
      <StudioPage />
    </ContentClientContext.Provider>
  );
}
