// Route table for the operator console. Every one of the 16 rail items resolves to a real route; the
// three built this wave (Dashboard, Content CMS, Content detail) render their views, and the other thirteen
// render an explicit coming-soon empty state (reachable, no dead end). The dashboard KPI cards drill
// through to filtered report routes (e.g. /admin/analytics?metric=revenue) which also land on a real,
// populated coming-soon report so the drill-through is never a dead end. The default path redirects to the
// dashboard. WCAG 2.2 AA. No emojis, no em dashes.
import { useEffect } from "react";
import { EmptyState } from "@axessplayer/ui";
import { matchPath, useRouter } from "./router/router";
import { Dashboard } from "./pages/Dashboard";
import { Content } from "./pages/Content";
import { ContentDetail } from "./pages/ContentDetail";
import { StoryGraph } from "./pages/StoryGraph";
import { MediaFactory } from "./pages/MediaFactory";
import { AccessibilityFactory } from "./pages/AccessibilityFactory";
import { Brands } from "./pages/Brands";
import { Users, UserDetailPage } from "./pages/Users";
import { Creators, CreatorDetailPage } from "./pages/Creators";
import { Monetization } from "./pages/Monetization";
import { Analytics } from "./pages/Analytics";
import { Growth } from "./pages/Growth";
import { ComingSoon } from "./pages/ComingSoon";
import { PageHead } from "./pages/Page";
import { NAV_ITEMS } from "./shell/nav";

// Sections built this wave handle their own route; the rest fall through to ComingSoon by label.
const SECTION_SUBTITLE: Record<string, string> = {
  moderation: "Flagged comments and uploads, with an immutable action audit log.",
  monetization: "Credits, subscriptions, ads, and brand revenue. Reward weights are display-only.",
  analytics: "Watch, branch, completion, accessibility, and revenue reports.",
  growth: "User acquisition, campaigns, and attribution.",
  billing: "Invoices, creator payouts, and settlement.",
  trust: "Rights, consent ledger, and C2PA provenance.",
  health: "Service status, processing failures, and spend caps.",
  settings: "Operators, roles, and the immutable admin audit log. Real operator MFA is a cutover gate.",
};

// A filtered-report drill target. The dashboard cards link here; it always renders (no dead end) and names
// the metric/filter it was opened with, so the drill-through is honest about what it will eventually show.
function ReportStub({ section, query }: { section: string; query: URLSearchParams }) {
  const item = NAV_ITEMS.find((i) => i.path === `/admin/${section}`);
  const params = Array.from(query.entries());
  return (
    <section className="adm-page">
      <PageHead
        title={item?.label ?? "Report"}
        subtitle={SECTION_SUBTITLE[section] ?? "Filtered operator report."}
      />
      <EmptyState title="Report coming soon">
        {params.length > 0 ? (
          <span>
            Filtered by{" "}
            {params.map(([k, v], i) => (
              <span key={k} className="adm-note">
                {i > 0 ? " · " : ""}
                {k}={v}
              </span>
            ))}
            . The interactive report ships in a later wave; this drill-through is routed and reachable.
          </span>
        ) : (
          <span>The interactive report ships in a later wave; this route is reachable, not a dead end.</span>
        )}
      </EmptyState>
    </section>
  );
}

export function Routes() {
  const { path, query, navigate } = useRouter();

  // Default + bare /admin -> dashboard.
  useEffect(() => {
    if (path === "/" || path === "/admin" || path === "/admin/") {
      navigate("/admin/dashboard", { replace: true });
    }
  }, [path, navigate]);

  if (path === "/" || path === "/admin" || path === "/admin/") {
    return null; // redirecting
  }

  if (path === "/admin/dashboard") return <Dashboard />;
  if (path === "/admin/content") return <Content />;

  const detail = matchPath("/admin/content/:id", path);
  if (detail) return <ContentDetail id={detail.id} />;

  // Section 4: Story graph (a series-scoped node editor view). A bare /admin/story-graph redirects to the
  // default demo series so the rail item always lands on a real graph (no dead end).
  const graph = matchPath("/admin/story-graph/:seriesId", path);
  if (graph) return <StoryGraph seriesId={graph.seriesId} />;
  if (path === "/admin/story-graph" || path === "/admin/story-graph/") {
    return <StoryGraph seriesId="ser_shadow" />;
  }

  // Section 5: Media factory (produce DAG).
  if (path === "/admin/media-factory" || path === "/admin/media-factory/") return <MediaFactory />;

  // Section 6: Accessibility factory.
  if (path === "/admin/accessibility" || path === "/admin/accessibility/") return <AccessibilityFactory />;

  // Section 7: Brand integration. The rail item is /admin/brands; campaigns and placements are sibling views
  // of the same surface (the firewall boundary + a view switcher) so all three resolve to a real page.
  if (path === "/admin/brands" || path === "/admin/brands/") return <Brands view="brands" />;
  if (path === "/admin/campaigns" || path === "/admin/campaigns/") return <Brands view="campaigns" />;
  if (path === "/admin/placements" || path === "/admin/placements/") return <Brands view="placements" />;

  // Section 8: Users (minimized list + privacy-gated detail).
  const userDetail = matchPath("/admin/users/:id", path);
  if (userDetail) return <UserDetailPage id={userDetail.id} />;
  if (path === "/admin/users" || path === "/admin/users/") return <Users />;

  // Section 9: Creators (list + read-only detail).
  const creatorDetail = matchPath("/admin/creators/:id", path);
  if (creatorDetail) return <CreatorDetailPage id={creatorDetail.id} />;
  if (path === "/admin/creators" || path === "/admin/creators/") return <Creators />;

  // Section 10: Monetization (pricing-rules engine, read this wave; reward weights display-only).
  if (path === "/admin/monetization" || path === "/admin/monetization/") return <Monetization />;

  // Section 11: Analytics (dimension-switched reports; the dim query param selects the report, every lift is
  // a band). Handled before the generic query-driven ReportStub fallthrough so ?dim= lands on the real view.
  if (path === "/admin/analytics" || path === "/admin/analytics/") return <Analytics />;

  // Section 12: Growth & UA (bandit win-rates, CAC/LTV/payback, referral-loop health).
  if (path === "/admin/growth" || path === "/admin/growth/") return <Growth />;

  // The remaining not-yet-built sections (and any drill-through that targets them with a query): a real
  // report stub when there is a query (a drill target), otherwise the section coming-soon state.
  const section = path.replace(/^\/admin\//, "").split("/")[0];
  const item = NAV_ITEMS.find((i) => i.path === `/admin/${section}`);
  if (item) {
    if (Array.from(query.keys()).length > 0) return <ReportStub section={section} query={query} />;
    return <ComingSoon title={item.label} subtitle={SECTION_SUBTITLE[section]} />;
  }

  // Unknown route: honest 404 with a way back (no dead end).
  return (
    <section className="adm-page">
      <PageHead title="Page not found" />
      <EmptyState title="Nothing here">That operator route does not exist.</EmptyState>
    </section>
  );
}
