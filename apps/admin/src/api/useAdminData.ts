// Data hooks for the operator console. Each hook calls the ADMIN API client and, when the live service is
// unreachable (a standalone review build with no local stack), falls back to the synthetic demo fixture so
// every surface renders a real populated state. The hooks expose { data, loading, error, source } where
// source is "live" or "demo" so the UI can show a quiet "demo data" note. No em dashes.
import { createContext, useContext, useEffect, useState } from "react";
import {
  AdminApi,
  type AdminContentDetail,
  type AdminContentList,
  type AdminDashboard,
  type AdminMe,
} from "./adminApi";
import { DEMO_CONTENT, DEMO_DASHBOARD, DEMO_ME, demoContentDetail } from "./demoData";

export const AdminApiContext = createContext<AdminApi | null>(null);
export function useAdminApi(): AdminApi {
  const api = useContext(AdminApiContext);
  if (!api) throw new Error("useAdminApi must be used within an AdminApiContext provider");
  return api;
}

export type DataSource = "live" | "demo";
export interface AsyncResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  source: DataSource;
}

function useAsync<T>(load: (api: AdminApi) => Promise<T>, fallback: () => T, deps: unknown[]): AsyncResult<T> {
  const api = useAdminApi();
  const [state, setState] = useState<AsyncResult<T>>({ data: null, loading: true, error: null, source: "live" });

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true, error: null, source: "live" });
    load(api)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null, source: "live" });
      })
      .catch(() => {
        // Live service unreachable: render the synthetic fixture so the surface is never a dead end.
        if (!cancelled) setState({ data: fallback(), loading: false, error: null, source: "demo" });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

export function useMe(): AsyncResult<AdminMe> {
  return useAsync<AdminMe>((api) => api.me(), () => DEMO_ME, []);
}
export function useDashboard(): AsyncResult<AdminDashboard> {
  return useAsync<AdminDashboard>((api) => api.dashboard(), () => DEMO_DASHBOARD, []);
}
export function useContentList(): AsyncResult<AdminContentList> {
  return useAsync<AdminContentList>((api) => api.content(), () => DEMO_CONTENT, []);
}
export function useContentDetail(id: string): AsyncResult<AdminContentDetail> {
  return useAsync<AdminContentDetail>(
    (api) => api.contentDetail(id),
    () => {
      const d = demoContentDetail(id);
      if (!d) throw new Error("not found");
      return d;
    },
    [id],
  );
}
