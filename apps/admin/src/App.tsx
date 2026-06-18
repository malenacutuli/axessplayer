// Operator-console app root. Builds the ADMIN API client (operator bearer over VITE_ADMIN_API_BASE_URL),
// loads GET /admin/me for the operator + role (an operator-auth shell), then renders the app shell + routes
// inside a RoleProvider so the RBAC helper (can(role, action)) gates the UI everywhere. While /admin/me is
// loading the shell shows a quiet loading state; real operator MFA is a CUTOVER GATE in front of this
// shell. WCAG 2.2 AA. No emojis, no em dashes.
import { useMemo } from "react";
import { Skeleton } from "@axessplayer/ui";
import { AdminApi, resolveAdminBaseUrl, resolveOperatorToken } from "./api/adminApi";
import { AdminApiContext, useMe } from "./api/useAdminData";
import { RoleProvider } from "./access/useRole";
import { AppShell } from "./shell/AppShell";
import { Routes } from "./Routes";

function Authed() {
  // operator-auth shell: the role chip + RBAC all derive from GET /admin/me.
  const { data: me, loading } = useMe();

  if (loading || !me) {
    return (
      <div style={{ padding: 36 }}>
        <Skeleton height={60} radius={12} />
        <div style={{ marginTop: 16 }}>
          <Skeleton height={320} radius={14} />
        </div>
      </div>
    );
  }

  return (
    <RoleProvider me={me}>
      <AppShell>
        <Routes />
      </AppShell>
    </RoleProvider>
  );
}

export function App() {
  const api = useMemo(
    () => new AdminApi({ baseUrl: resolveAdminBaseUrl(), token: resolveOperatorToken() }),
    [],
  );
  return (
    <AdminApiContext.Provider value={api}>
      <Authed />
    </AdminApiContext.Provider>
  );
}
