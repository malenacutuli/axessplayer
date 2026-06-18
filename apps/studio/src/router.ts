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

// Read the SECOND path segment after the section slug, e.g. the series id in #/studio/content/<id>. Returns
// an empty string when there is no sub-segment. Used by the Modify content section (11) to deep-link a title.
export function readSectionParam(): string {
  if (typeof window === "undefined") return "";
  const hash = window.location.hash || "";
  if (!hash.startsWith(PREFIX)) return "";
  const rest = hash.slice(PREFIX.length).replace(/^\//, "");
  const parts = rest.split(/[/?]/);
  return parts[1] ? decodeURIComponent(parts[1]) : "";
}

// Build a href that targets a section with a sub-param, e.g. #/studio/content/<id>.
export function sectionParamHref(slug: string, param: string): string {
  return `${PREFIX}/${slug}/${encodeURIComponent(param)}`;
}

// Subscribe to the hash route and expose programmatic navigation. Back/forward work because we push real
// history entries.
export function useStudioRoute(): {
  section: string;
  param: string;
  navigate: (slug: string) => void;
  navigateParam: (slug: string, param: string) => void;
} {
  const [section, setSection] = useState<string>(() => readSection());
  const [param, setParam] = useState<string>(() => readSectionParam());

  useEffect(() => {
    const onHash = () => {
      setSection(readSection());
      setParam(readSectionParam());
    };
    window.addEventListener("hashchange", onHash);
    // Establish a canonical hash on first load so the URL always reflects the active section.
    if (!window.location.hash.startsWith(PREFIX)) {
      window.history.replaceState(null, "", sectionHref("dashboard"));
    }
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((slug: string) => {
    if (readSection() === slug && readSectionParam() === "") return;
    window.location.hash = sectionHref(slug);
  }, []);

  const navigateParam = useCallback((slug: string, p: string) => {
    if (readSection() === slug && readSectionParam() === p) return;
    window.location.hash = sectionParamHref(slug, p);
  }, []);

  return { section, param, navigate, navigateParam };
}
