// App root: build the content client from the configurable base URL and provide it to the tree, wrapped in
// the Creator Studio auth provider. The top-level surface is CreatorStudio (auth shell + 14-section rail +
// dashboard + the authoring workflow). No em dashes.
import { useMemo } from "react";
import { ContentClient } from "./api/client.js";
import { ContentClientContext } from "./api/useContentClient.js";
import { resolveContentBaseUrl } from "./api/config.js";
import { CreatorStudio } from "./components/CreatorStudio.js";
import { CreatorAuthProvider } from "./auth/creatorAuth.js";

export function App(): JSX.Element {
  const client = useMemo(() => new ContentClient({ baseUrl: resolveContentBaseUrl() }), []);
  return (
    <ContentClientContext.Provider value={client}>
      <CreatorAuthProvider>
        <CreatorStudio />
      </CreatorAuthProvider>
    </ContentClientContext.Provider>
  );
}
