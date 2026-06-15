// Browser entry point. Builds the clients from the runtime config and a session provider, then mounts
// the app. In production the session provider is the Supabase access token; here a first-touch demo
// session is used so the public /watch surface works for an unauthenticated viewer. Identity is the
// session subject, never a request body field (F1). No em dashes.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { buildClients } from "./clients.js";
import { staticSession } from "./api/session.js";
import "./styles.css";

// The walking-skeleton series id (see supabase/seed.sql). Configurable per deployment in a later pass.
const SERIES_ID = "11111111-1111-1111-1111-111111111111";
// Demo viewing identity for the first-touch public surface. Production reads this from Supabase auth.
const DEMO_USER = "aaaaaaaa-0000-0000-0000-000000000001";

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const session = staticSession(env.VITE_SESSION_TOKEN ?? "demo-session-token");

const clients = buildClients({ session });

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App clients={clients} seriesId={SERIES_ID} userId={DEMO_USER} />
    </StrictMode>,
  );
}
