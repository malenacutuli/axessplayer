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
import { ComingSoon } from "./pages/ComingSoon";
import { PageHead } from "./pages/Page";
import { NAV_ITEMS } from "./shell/nav";

// Sections built this wave handle their own route; the rest fall through to ComingSoon by label.
const SECTION_SUBTITLE: Record<string, string> = {
  storygraph: "Versioned adaptive graph: beats, choices, POVs, endings, and per-viewer memory variables.",
  media: "Upload once, everything automatic. The auto-produce DAG with per-stage cost and the cost gate.",
  accessibility: "Captions, audio description, sign, and dubs across every variant, with coverage.",
  brands: "Brand integrations behind the content and ad firewall. Content never blends with paid placement.",
  users: "Accounts, sessions, consent, and GDPR data-subject actions. No biometric data leaves the plane.",
  creators: "Creator accounts, revenue share, and content portfolios.",
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

  // The thirteen not-yet-built sections (and any drill-through that targets them with a query): a real
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
