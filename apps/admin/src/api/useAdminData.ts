// Data hooks for the operator console. Each hook calls the ADMIN API client and, when the live service is
// unreachable (a standalone review build with no local stack), falls back to the synthetic demo fixture so
// every surface renders a real populated state. The hooks expose { data, loading, error, source } where
// source is "live" or "demo" so the UI can show a quiet "demo data" note. No em dashes.
import { createContext, useContext, useEffect, useState } from "react";
import {
  AdminApi,
  type AdminAccessibility,
  type AdminBrands,
  type AdminCampaigns,
  type AdminContentDetail,
  type AdminContentList,
  type AdminCreators,
  type AdminDashboard,
  type AdminMe,
  type AdminPlacements,
  type AdminUsers,
  type CreatorDetail,
  type MediaFactoryJobs,
  type StoryGraph,
  type UserDetail,
} from "./adminApi";
import {
  DEMO_ACCESSIBILITY,
  DEMO_BRANDS,
  DEMO_CAMPAIGNS,
  DEMO_CONTENT,
  DEMO_CREATORS,
  DEMO_DASHBOARD,
  DEMO_MEDIA_JOBS,
  DEMO_ME,
  DEMO_PLACEMENTS,
  DEMO_USERS,
  demoContentDetail,
  demoCreatorDetail,
  demoStoryGraph,
  demoUserDetail,
} from "./demoData";

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
export function useStoryGraph(seriesId: string): AsyncResult<StoryGraph> {
  return useAsync<StoryGraph>((api) => api.storyGraph(seriesId), () => demoStoryGraph(seriesId), [seriesId]);
}
export function useMediaFactoryJobs(): AsyncResult<MediaFactoryJobs> {
  return useAsync<MediaFactoryJobs>((api) => api.mediaFactoryJobs(), () => DEMO_MEDIA_JOBS, []);
}
export function useAccessibility(): AsyncResult<AdminAccessibility> {
  return useAsync<AdminAccessibility>((api) => api.accessibility(), () => DEMO_ACCESSIBILITY, []);
}

// Section 7: brand integration. The endpoints are operator-authed and currently return empty (brand tables
// not in the hosted schema yet); the demo fallback is also empty so the surface shows the same honest empty
// state plus the firewall note.
export function useBrands(): AsyncResult<AdminBrands> {
  return useAsync<AdminBrands>((api) => api.brands(), () => DEMO_BRANDS, []);
}
export function useCampaigns(): AsyncResult<AdminCampaigns> {
  return useAsync<AdminCampaigns>((api) => api.campaigns(), () => DEMO_CAMPAIGNS, []);
}
export function usePlacements(): AsyncResult<AdminPlacements> {
  return useAsync<AdminPlacements>((api) => api.placements(), () => DEMO_PLACEMENTS, []);
}

// Section 8: users.
export function useUsers(): AsyncResult<AdminUsers> {
  return useAsync<AdminUsers>((api) => api.users(), () => DEMO_USERS, []);
}
export function useUserDetail(id: string): AsyncResult<UserDetail> {
  return useAsync<UserDetail>(
    (api) => api.userDetail(id),
    () => {
      const d = demoUserDetail(id);
      if (!d) throw new Error("not found");
      return d;
    },
    [id],
  );
}

// Section 9: creators.
export function useCreators(): AsyncResult<AdminCreators> {
  return useAsync<AdminCreators>((api) => api.creators(), () => DEMO_CREATORS, []);
}
export function useCreatorDetail(id: string): AsyncResult<CreatorDetail> {
  return useAsync<CreatorDetail>(
    (api) => api.creatorDetail(id),
    () => {
      const d = demoCreatorDetail(id);
      if (!d) throw new Error("not found");
      return d;
    },
    [id],
  );
}
