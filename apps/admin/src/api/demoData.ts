// Demo data for the operator console. The ADMIN API endpoints are served by the content service in the
// local stack; when that service is not running (a standalone review build) the data hooks fall back to
// this fixture so every surface renders a real, populated state instead of an error. The shapes match the
// ADMIN API CONTRACT exactly. No live/biometric/personal data lives here, it is synthetic. No em dashes.
import type {
  AdminContentDetail,
  AdminContentList,
  AdminDashboard,
  AdminMe,
  ContentNode,
} from "./adminApi";

export const DEMO_ME: AdminMe = {
  operator: { id: "op_demo", name: "Avery Operator", email: "operator@axessible.ai" },
  role: "Owner",
};

export const DEMO_DASHBOARD: AdminDashboard = {
  kpis: [
    { key: "users", label: "Total users", value: "2.41M", trend: "+4.2% vs prior 28d", drillTo: "/admin/users", tone: "neutral" },
    { key: "dau", label: "DAU / WAU / MAU", value: "318k", trend: "WAU 1.1M · MAU 2.0M", drillTo: "/admin/analytics?metric=active_users", tone: "neutral" },
    { key: "watch_starts", label: "Watch starts", value: "9.1M", trend: "+6.0% vs prior 28d", drillTo: "/admin/analytics?metric=watch_starts", tone: "neutral" },
    { key: "completions", label: "Episode completions", value: "78.4%", trend: "+1.3pp", drillTo: "/admin/analytics?metric=completions", tone: "neutral" },
    { key: "branch_decisions", label: "Branch decisions", value: "4.4M", trend: "+8.1% vs prior 28d", drillTo: "/admin/analytics?metric=branch_decisions", tone: "neutral" },
    { key: "credits", label: "Credits purchased / spent", value: "1.9M / 1.4M", trend: "73% spend rate", drillTo: "/admin/monetization?view=credits", tone: "gold" },
    {
      key: "revenue",
      label: "Revenue by source",
      value: "$1.84M",
      drillTo: "/admin/analytics?metric=revenue",
      tone: "neutral",
      // Counterfactual revenue lift band from the adaptive cut selection, shown as a band, never a point.
      band: { low: 8, high: 19, center: 13, label: "Estimated adaptive revenue lift between 8% and 19%" },
    },
    { key: "payouts", label: "Creator payouts", value: "$1.28M", trend: "settled this period", drillTo: "/admin/billing?view=payouts", tone: "neutral" },
    { key: "accessibility", label: "Accessibility usage", value: "41.6%", trend: "+2.0pp", drillTo: "/admin/analytics?metric=accessibility", tone: "green" },
    { key: "top_series", label: "Top series", value: "Shadow Signal", trend: "486 variants · 100% a11y", drillTo: "/admin/content", tone: "neutral" },
  ],
  topSeries: [
    {
      key: "revenue_by_source",
      label: "Revenue by source",
      points: [
        { label: "Mar", segments: [{ key: "Coins", value: 40 }, { key: "Subs", value: 14 }, { key: "Ads", value: 18 }, { key: "Brand", value: 6 }] },
        { label: "Apr", segments: [{ key: "Coins", value: 46 }, { key: "Subs", value: 16 }, { key: "Ads", value: 20 }, { key: "Brand", value: 8 }] },
        { label: "May", segments: [{ key: "Coins", value: 52 }, { key: "Subs", value: 18 }, { key: "Ads", value: 22 }, { key: "Brand", value: 11 }] },
        { label: "Jun", segments: [{ key: "Coins", value: 62 }, { key: "Subs", value: 22 }, { key: "Ads", value: 26 }, { key: "Brand", value: 15 }] },
      ],
    },
  ],
};

const VARIANTS_SHADOW: ContentNode[] = [
  { id: "var_shadow_ep1_a", kind: "variant", title: "Ep1 · Maya POV · EN", status: "live", a11yCoverage: 100, provenanceVerified: true },
  { id: "var_shadow_ep1_b", kind: "variant", title: "Ep1 · Luca POV · EN", status: "live", a11yCoverage: 100, provenanceVerified: true },
];

export const DEMO_CONTENT: AdminContentList = {
  tree: [
    {
      id: "chan_drama",
      kind: "channel",
      title: "Drama",
      status: "live",
      children: [
        {
          id: "ser_shadow",
          kind: "series",
          title: "Shadow Signal",
          status: "live",
          channel: "Drama",
          variantCount: 486,
          a11yCoverage: 100,
          provenanceVerified: true,
          children: [
            { id: "ep_shadow_1", kind: "episode", title: "Ep1 · Cold open", status: "live", variantCount: 24, a11yCoverage: 100, provenanceVerified: true, children: VARIANTS_SHADOW },
            { id: "ep_shadow_2", kind: "episode", title: "Ep2 · The lie", status: "live", variantCount: 24, a11yCoverage: 100, provenanceVerified: true },
          ],
        },
      ],
    },
    {
      id: "chan_crime",
      kind: "channel",
      title: "Crime",
      status: "live",
      children: [
        {
          id: "ser_director",
          kind: "series",
          title: "The Director's Daughter",
          status: "processing",
          channel: "Crime",
          variantCount: 312,
          a11yCoverage: 64,
          provenanceVerified: true,
          children: [
            { id: "ep_director_3", kind: "episode", title: "Ep3 · The reveal", status: "processing", variantCount: 48, a11yCoverage: 64, provenanceVerified: true },
          ],
        },
      ],
    },
    {
      id: "chan_telenovela",
      kind: "channel",
      title: "Telenovela",
      status: "live",
      children: [
        { id: "ser_vow", kind: "series", title: "A Vow in Code", status: "review", channel: "Telenovela", variantCount: 528, a11yCoverage: 92, provenanceVerified: true },
        { id: "ser_heiress", kind: "series", title: "The Hidden Heiress", status: "live", channel: "Telenovela", variantCount: 540, a11yCoverage: 100, provenanceVerified: true },
      ],
    },
  ],
};

// Flatten the tree into a lookup so a detail route can resolve any node id when the live service is absent.
function flatten(nodes: ContentNode[], acc: Map<string, ContentNode>): Map<string, ContentNode> {
  for (const n of nodes) {
    acc.set(n.id, n);
    if (n.children) flatten(n.children, acc);
  }
  return acc;
}
const FLAT = flatten(DEMO_CONTENT.tree, new Map());

export function demoContentDetail(id: string): AdminContentDetail | undefined {
  const node = FLAT.get(id);
  if (!node) return undefined;
  return {
    node,
    meta: [
      { label: "Kind", value: node.kind },
      { label: "Status", value: node.status },
      { label: "Channel", value: node.channel ?? "—" },
      { label: "Variants", value: node.variantCount != null ? String(node.variantCount) : "—" },
      { label: "Accessibility coverage", value: node.a11yCoverage != null ? `${node.a11yCoverage}%` : "—" },
      { label: "Provenance", value: node.provenanceVerified ? "C2PA verified" : "Not verified" },
    ],
  };
}
