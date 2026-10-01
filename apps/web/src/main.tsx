// Browser entry point. Builds the clients from the runtime config and a session provider, then mounts
// the app. The session provider is the viewer's Supabase access token (a dev build may pin a test token).
// Identity is the session subject, never a request body field (F1). No em dashes.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./Root.js";
import { buildClients } from "./clients.js";
import { staticSession, supabaseSession } from "./api/session.js";
import { AuthProvider, getSupabase } from "./auth/index.js";
import { RouterProvider } from "./router/router.js";
// Shared design-system fonts + tokens (the --axp-* set), imported ALONGSIDE the existing brand tokens so
// both --bg/--ink and --axp-* are available. Order: design-system fonts/tokens first, then the brand
// tokens (the official guideline variables), then the app styles that consume them, then auth styles.
import "@axessplayer/ui/fonts.css";
import "@axessplayer/ui/tokens.css";
import "./styles/brand-tokens.css";
import "./styles.css";
import "./styles/discover.css";
import "./auth/auth.css";

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
// Series id and viewing identity are per-deployment. They default to the local walking-skeleton seed
// (supabase/seed.sql) but are overridable via env so the SAME build runs against the hosted mobile schema:
// set VITE_SERIES_ID and VITE_DEMO_USER (and, for a dev build only, VITE_SESSION_TOKEN=session:<uuid>) in
// apps/web/.env.local.
const SERIES_ID = env.VITE_SERIES_ID ?? "11111111-1111-1111-1111-111111111111";
const DEMO_USER = env.VITE_DEMO_USER ?? "aaaaaaaa-0000-0000-0000-000000000001";
// The services verify every bearer against Supabase, so production always sends the signed-in viewer's
// live Supabase access token (null when signed out). A fixed VITE_SESSION_TOKEN is honoured ONLY in a dev
// build (local stacks running the test verifier); a production bundle never ships a shared demo identity.
const isDevBuild = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
const session =
  isDevBuild && env.VITE_SESSION_TOKEN ? staticSession(env.VITE_SESSION_TOKEN) : supabaseSession(getSupabase);

const clients = buildClients({ session });

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <RouterProvider>
        <AuthProvider>
          <Root clients={clients} seriesId={SERIES_ID} userId={DEMO_USER} />
        </AuthProvider>
      </RouterProvider>
    </StrictMode>,
  );
}
