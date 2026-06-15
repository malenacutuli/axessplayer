// The consent boundary. Before the app renders, a viewer must accept the Terms and Privacy Policy for the
// current policy version (the signup gate). Once accepted, the app renders and the consent controls are
// passed down so Profile can show the GDPR data-subject actions. Erasing consent returns the viewer to the
// gate. No em dashes.

import { App } from "./App.js";
import type { Clients } from "./clients.js";
import { ConsentGate } from "./consent/ConsentGate.js";
import { useConsent, type ConsentControls } from "./consent/useConsent.js";
import type { ConsentStore } from "./consent/store.js";

export interface RootProps {
  clients: Clients;
  seriesId: string;
  userId: string;
  viewerName?: string;
  // Injectable for tests.
  consentStore?: ConsentStore;
}

export function Root({ clients, seriesId, userId, viewerName, consentStore }: RootProps): JSX.Element {
  const consent: ConsentControls = useConsent(consentStore);

  if (consent.needsConsent) {
    return <ConsentGate onAccept={consent.accept} />;
  }

  return (
    <App
      clients={clients}
      seriesId={seriesId}
      userId={userId}
      viewerName={viewerName}
      consent={consent}
    />
  );
}
