// BRAND INTEGRATION (section 7): /admin/brands, /admin/campaigns, /admin/placements. Brand accounts, their
// campaigns, and the placement slots linked to content, with suitability + brand-safety scores, targeting
// summary, a generation-time placement PREVIEW affordance, sponsored disclosure, the deal model
// (CPM/CPA/CPC/flat), an approval workflow, and performance + revenue attribution (counterfactual lift as a
// BAND). The CONTENT / AD PLANE FIREWALL is shown as a labeled boundary on every view: brand data never
// influences content ranking. Brand tables are NOT in the hosted schema yet, so the endpoints return empty;
// the UI renders a real "no campaigns yet" empty state plus the firewall note (no dead end), never
// fabricated rows. RBAC: brands.view -> Marketing / Admin / Owner; ReadOnly sees a read-only mirror.
// WCAG 2.2 AA. No emojis, no em dashes.
import { Button, EmptyState, ErrorState, LiftBand, Skeleton } from "@axessplayer/ui";
import { useBrands, useCampaigns, usePlacements } from "../api/useAdminData";
import type { ApprovalStep, CampaignStatus, DealModel } from "../api/adminApi";
import { PageHead } from "./Page";
import { Link, useRouter } from "../router/router";
import { useRole } from "../access/useRole";

type BrandView = "brands" | "campaigns" | "placements";

const DEAL_LABEL: Record<DealModel, string> = { CPM: "CPM", CPA: "CPA", CPC: "CPC", flat: "Flat fee" };
const CAMPAIGN_LABEL: Record<CampaignStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  live: "Live",
  paused: "Paused",
  ended: "Ended",
};
const APPROVAL_LABEL: Record<ApprovalStep, string> = {
  submitted: "Submitted",
  brand_safety: "Brand safety",
  legal: "Legal",
  operator_approval: "Operator approval",
  approved: "Approved",
  rejected: "Rejected",
};

// The content/ad firewall boundary, surfaced on every brand view so the gate is visible.
function FirewallNote() {
  return (
    <div className="adm-firewall" role="note">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M12 4v16M3 9h6M15 9h6M9 14h6" />
      </svg>
      <span>
        Content / ad plane firewall. Brand and ad data on this side never crosses into content ranking,
        recommendations, or cut selection. Placements are composited at generation time only; they never
        weight what a viewer is shown.
      </span>
    </div>
  );
}

function ViewTabs({ current }: { current: BrandView }) {
  const tabs: Array<{ key: BrandView; label: string; to: string }> = [
    { key: "brands", label: "Brand accounts", to: "/admin/brands" },
    { key: "campaigns", label: "Campaigns", to: "/admin/campaigns" },
    { key: "placements", label: "Placements", to: "/admin/placements" },
  ];
  return (
    <div className="adm-subtabs" role="tablist" aria-label="Brand integration views">
      {tabs.map((t) => (
        <Link
          key={t.key}
          to={t.to}
          role="tab"
          aria-selected={current === t.key}
          className={`adm-subtab ${current === t.key ? "is-active" : ""}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

function safetyTone(score: number): string {
  if (score >= 80) return "adm-score--good";
  if (score >= 60) return "adm-score--warn";
  return "adm-score--bad";
}

export function Brands({ view }: { view: BrandView }) {
  const { can, isReadOnly } = useRole();
  const { navigate } = useRouter();

  // RBAC: brands are Marketing / Admin / Owner (ReadOnly mirrors). A role without the grant gets an honest
  // access state with a way back (no dead end), never the data.
  if (!can("brands.view")) {
    return (
      <section className="adm-page">
        <PageHead title="Brand integration" subtitle="Brand accounts, campaigns, and placement slots behind the content/ad firewall." />
        <ErrorState
          title="Not available for your role"
          action={<Button variant="secondary" onClick={() => navigate("/admin/dashboard")}>Back to dashboard</Button>}
        >
          Brand integration is limited to Marketing, Admin, and Owner roles.
        </ErrorState>
      </section>
    );
  }

  return (
    <section className="adm-page">
      <PageHead
        title="Brand integration"
        subtitle="Brand accounts, campaigns, and placements. Read-only this wave; brand approval and edits arrive next."
        right={isReadOnly ? <span className="adm-pill" title="Read-only role">Read-only</span> : undefined}
      />
      <FirewallNote />
      <ViewTabs current={view} />
      {view === "brands" && <BrandsList />}
      {view === "campaigns" && <CampaignsList />}
      {view === "placements" && <PlacementsList />}
    </section>
  );
}

function NoBrandData({ what }: { what: string }) {
  return (
    <EmptyState title={`No ${what} yet`}>
      Brand integration tables are not provisioned in this environment yet, so there are no {what} to show.
      This surface is routed and reachable; rows appear here once a brand account is onboarded. Per the
      content / ad firewall, none of this data will ever influence content ranking.
    </EmptyState>
  );
}

function BrandsList() {
  const { data, loading, error, source } = useBrands();
  if (loading) return <Skeleton height={260} radius={14} />;
  if (error || !data) return <ErrorState title="Brands unavailable">The brand accounts could not be loaded. Try again shortly.</ErrorState>;
  if (data.brands.length === 0) return <BrandSection source={source}><NoBrandData what="brand accounts" /></BrandSection>;
  return (
    <BrandSection source={source}>
      <div className="adm-table" aria-label="Brand accounts">
        <div className="adm-tr adm-tr--brands adm-thead">
          <span>BRAND</span>
          <span>INDUSTRY</span>
          <span>SAFETY</span>
          <span>CAMPAIGNS</span>
          <span>STATUS</span>
        </div>
        {data.brands.map((b) => (
          <div key={b.id} className="adm-tr adm-tr--brands">
            <span className="adm-cell-title">{b.name}</span>
            <span className="adm-cell-muted">{b.industry}</span>
            <span className={`adm-score ${safetyTone(b.safetyScore)}`}>{b.safetyScore}</span>
            <span className="adm-cell-mono">{b.campaignCount}</span>
            <span className="adm-cell-muted">{b.status}</span>
          </div>
        ))}
      </div>
    </BrandSection>
  );
}

function CampaignsList() {
  const { data, loading, error, source } = useCampaigns();
  if (loading) return <Skeleton height={260} radius={14} />;
  if (error || !data) return <ErrorState title="Campaigns unavailable">The campaigns could not be loaded. Try again shortly.</ErrorState>;
  if (data.campaigns.length === 0) return <BrandSection source={source}><NoBrandData what="campaigns" /></BrandSection>;
  return (
    <BrandSection source={source}>
      <div className="adm-table" aria-label="Campaigns">
        <div className="adm-tr adm-tr--campaigns adm-thead">
          <span>CAMPAIGN</span>
          <span>BRAND</span>
          <span>DEAL</span>
          <span>RATE</span>
          <span>APPROVAL</span>
          <span>STATUS</span>
        </div>
        {data.campaigns.map((c) => (
          <div key={c.id} className="adm-tr adm-tr--campaigns">
            <span className="adm-cell-title">{c.name}</span>
            <span className="adm-cell-muted">{c.brandName}</span>
            <span className="adm-cell-mono">{DEAL_LABEL[c.deal]}</span>
            <span className="adm-cell-mono">{c.rate}</span>
            <span className="adm-cell-muted">{APPROVAL_LABEL[c.approval]}</span>
            <span className="adm-cell-muted">{CAMPAIGN_LABEL[c.status]}</span>
          </div>
        ))}
      </div>
    </BrandSection>
  );
}

function PlacementsList() {
  const { data, loading, error, source } = usePlacements();
  if (loading) return <Skeleton height={260} radius={14} />;
  if (error || !data) return <ErrorState title="Placements unavailable">The placements could not be loaded. Try again shortly.</ErrorState>;
  if (data.placements.length === 0) return <BrandSection source={source}><NoBrandData what="placements" /></BrandSection>;
  return (
    <BrandSection source={source}>
      <div className="adm-placements">
        {data.placements.map((p) => (
          <section key={p.id} className="adm-card adm-placement" aria-label={`Placement ${p.campaignName}`}>
            <div className="adm-placement__head">
              <div>
                <div className="adm-cell-title">{p.campaignName}</div>
                <div className="adm-cell-muted">{p.brandName} · linked to {p.contentTitle}</div>
              </div>
              <span className="adm-pill">{p.slotKind.replace(/_/g, " ")}</span>
            </div>
            <div className="adm-placement__scores">
              <span className={`adm-score ${safetyTone(p.suitabilityScore)}`}>Suitability {p.suitabilityScore}</span>
              <span className={p.brandSafe ? "adm-pill adm-pill--ok" : "adm-pill adm-pill--warn"}>
                {p.brandSafe ? "Brand-safe" : "Flagged"}
              </span>
            </div>
            <p className="adm-note">Sponsored disclosure shown to viewer: {p.disclosure}</p>
            <div className="adm-placement__meta">
              <span className="adm-cell-mono">{p.impressions.toLocaleString("en-US")} impressions</span>
              <span className="adm-cell-mono">${p.revenue.toLocaleString("en-US")} revenue</span>
            </div>
            {p.liftBand && (
              <div className="adm-placement__lift">
                <div className="adm-cell-muted">Revenue attribution (counterfactual lift, shown as a band)</div>
                <LiftBand low={p.liftBand.low} high={p.liftBand.high} center={p.liftBand.center} label={p.liftBand.label} />
              </div>
            )}
            {/* Generation-time placement preview affordance: opens the composited slot preview when wired. */}
            <button className="adm-soon" disabled aria-disabled title="Generation-time placement preview arrives in a later wave">
              Preview placement (coming soon)
            </button>
          </section>
        ))}
      </div>
    </BrandSection>
  );
}

function BrandSection({ source, children }: { source: "live" | "demo"; children: React.ReactNode }) {
  return (
    <>
      {source === "demo" && <p className="adm-note" style={{ marginBottom: 12 }}>Demo data · live admin API not reachable</p>}
      {children}
    </>
  );
}
