// App root: build the content client from the configurable base URL and provide it to the tree, wrapped in
// the Creator Studio auth provider. The top-level surface is CreatorStudio (auth shell + 14-section rail +
// dashboard + the authoring workflow). No em dashes.
import { useMemo } from "react";
import { ContentClient } from "./api/client.js";
import { ContentClientContext } from "./api/useContentClient.js";
import { resolveContentBaseUrl } from "./api/config.js";
import { IngestionClient, resolveIngestionBaseUrl } from "./api/ingestion.js";
import { IngestionClientContext } from "./api/useIngestionClient.js";
import { CreatorStudio } from "./components/CreatorStudio.js";
import { CreatorAuthProvider } from "./auth/creatorAuth.js";

export function App(): JSX.Element {
  const client = useMemo(() => new ContentClient({ baseUrl: resolveContentBaseUrl() }), []);
  const ingestion = useMemo(() => new IngestionClient({ baseUrl: resolveIngestionBaseUrl() }), []);
  return (
    <ContentClientContext.Provider value={client}>
      <IngestionClientContext.Provider value={ingestion}>
        <CreatorAuthProvider>
          <CreatorStudio />
        </CreatorAuthProvider>
      </IngestionClientContext.Provider>
    </ContentClientContext.Provider>
  );
}
