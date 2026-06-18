// A tiny, dependency-free client router over the History API (copied from apps/web/src/router/router.tsx).
// The product (INTERACTION_MAP) requires each surface to be a real route so it is linkable and back-button
// safe; we add that without pulling a router dependency into the pinned workspace lockfile. It supports
// static paths and a single-segment param (":id"), a query string, and programmatic navigation. No em
// dashes.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export interface RouteState {
  path: string;
  query: URLSearchParams;
}

export interface RouterApi extends RouteState {
  navigate: (to: string, opts?: { replace?: boolean }) => void;
  back: () => void;
}

const RouterContext = createContext<RouterApi | null>(null);

function readLocation(): RouteState {
  const path = window.location.pathname || "/";
  const query = new URLSearchParams(window.location.search);
  return { path, query };
}

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<RouteState>(() =>
    typeof window === "undefined" ? { path: "/", query: new URLSearchParams() } : readLocation(),
  );

  useEffect(() => {
    const onPop = () => setState(readLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
    setState(readLocation());
  }, []);

  const back = useCallback(() => {
    window.history.back();
  }, []);

  const api = useMemo<RouterApi>(() => ({ ...state, navigate, back }), [state, navigate, back]);
  return <RouterContext.Provider value={api}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterApi {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used within a RouterProvider");
  return ctx;
}

// Match the current path against a pattern. Supports "/admin/content/:id" style single-segment params.
// Returns the captured params, or null when the pattern does not match. No trailing-slash sensitivity.
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.replace(/\/+$/, "") || "/";
  const cp = path.replace(/\/+$/, "") || "/";
  const ps = pp.split("/");
  const cs = cp.split("/");
  if (ps.length !== cs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < ps.length; i++) {
    const seg = ps[i];
    if (seg.startsWith(":")) {
      if (!cs[i]) return null;
      params[seg.slice(1)] = decodeURIComponent(cs[i]);
    } else if (seg !== cs[i]) {
      return null;
    }
  }
  return params;
}

// A declarative <Link> that uses the router (prevents full reloads). Renders a real anchor so it is
// keyboard- and screen-reader-friendly and middle-clickable.
export function Link({
  to,
  children,
  className,
  ...rest
}: { to: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
