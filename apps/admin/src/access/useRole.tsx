// The operator auth context. The role comes from GET /admin/me and is the single source the RBAC helper
// consults. Real operator MFA is a CUTOVER GATE: this shell carries an operator bearer and renders the
// authenticated console, but the production cutover must put an MFA-backed operator session in front of it
// (see the topbar note). No em dashes.
import { createContext, useContext } from "react";
import type { AdminMe, OperatorRole } from "../api/adminApi";
import { can as canFn, isReadOnly as isReadOnlyFn, type Action } from "./rbac";

export interface RoleApi {
  me: AdminMe;
  role: OperatorRole;
  can: (action: Action) => boolean;
  isReadOnly: boolean;
}

const RoleContext = createContext<RoleApi | null>(null);

export function RoleProvider({ me, children }: { me: AdminMe; children: React.ReactNode }) {
  const api: RoleApi = {
    me,
    role: me.role,
    can: (action) => canFn(me.role, action),
    isReadOnly: isReadOnlyFn(me.role),
  };
  return <RoleContext.Provider value={api}>{children}</RoleContext.Provider>;
}

export function useRole(): RoleApi {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within a RoleProvider");
  return ctx;
}
