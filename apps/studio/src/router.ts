// A tiny, dependency-free hash router for the Creator Studio. Every section is a real, linkable, back-button
// safe route (#/studio/<slug>); a hash router needs no server-side route config for the static deploy. We do
// NOT pull a router dependency into the pinned workspace lockfile. No em dashes.
import { useCallback, useEffect, useState } from "react";

const PREFIX = "#/studio";

// Read the current section slug from the location hash. Defaults to the dashboard.
export function readSection(): string {
  if (typeof window === "undefined") return "dashboard";
  const hash = window.location.hash || "";
  if (!hash.startsWith(PREFIX)) return "dashboard";
  const rest = hash.slice(PREFIX.length).replace(/^\//, "");
  const slug = rest.split(/[/?]/)[0];
  return slug.length > 0 ? slug : "dashboard";
}

export function sectionHref(slug: string): string {
  return `${PREFIX}/${slug}`;
}

// Subscribe to the hash route and expose programmatic navigation. Back/forward work because we push real
// history entries.
export function useStudioRoute(): { section: string; navigate: (slug: string) => void } {
  const [section, setSection] = useState<string>(() => readSection());

  useEffect(() => {
    const onHash = () => setSection(readSection());
    window.addEventListener("hashchange", onHash);
    // Establish a canonical hash on first load so the URL always reflects the active section.
    if (!window.location.hash.startsWith(PREFIX)) {
      window.history.replaceState(null, "", sectionHref("dashboard"));
    }
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((slug: string) => {
    if (readSection() === slug) return;
    window.location.hash = sectionHref(slug);
  }, []);

  return { section, navigate };
}
