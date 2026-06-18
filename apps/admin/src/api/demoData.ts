// Demo data for the operator console. The ADMIN API endpoints are served by the content service in the
// local stack; when that service is not running (a standalone review build) the data hooks fall back to
// this fixture so every surface renders a real, populated state instead of an error. The shapes match the
// ADMIN API CONTRACT exactly. No live/biometric/personal data lives here, it is synthetic. No em dashes.
import type {
  AdminAccessibility,
  AdminBrands,
  AdminCampaigns,
  AdminContentDetail,
  AdminContentList,
  AdminCreators,
  AdminDashboard,
  AdminGrowth,
  AdminMe,
  AdminMonetization,
  AdminPlacements,
  AdminUsers,
  AnalyticsDim,
  AnalyticsReport,
  ContentNode,
  CreatorDetail,
  MediaFactoryJobs,
  SimulateRequest,
  SimulateResult,
  StoryGraph,
  StoryValidation,
  UserDetail,
  ModerationQueue,
  ModerationPolicy,
  ConsentLedger,
  ProvenanceLedger,
  GdprQueue,
  AdminFinance,
  AdminHealth,
  AdminSettings,
  AuditPage,
  OperatorRole,
  RoleCapability,
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
    { key: "payouts", label: "Creator payouts", value: "$1.28M", trend: "settled this period", drillTo: "/admin/finance?view=payouts", tone: "neutral" },
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

/* --------------------------------- Story graph -------------------------------- */
// A small but representative adaptive graph for Shadow Signal: one episode, a beat, a timed branch with a
// default fallback, two POV cuts, an intensity dial, a premium (priced) cut, a locked ending, and two
// endings. Memory variables and canon rules included. Layout (col/row) is laid out by hand so the diagram
// reads left to right. Pricing is display only.
const STORY_SHADOW: StoryGraph = {
  seriesId: "ser_shadow",
  seriesTitle: "Shadow Signal",
  version: 7,
  defaultFallbackNodeId: "n_stay",
  nodes: [
    { id: "n_ep1", kind: "episode", title: "Ep1 · Cold open", col: 0, row: 1, writes: ["trust"] },
    { id: "n_beat1", kind: "beat", title: "The intercept", col: 1, row: 1, reads: ["trust"] },
    { id: "n_branch1", kind: "branch", title: "Answer the call?", col: 2, row: 1, reads: ["trust"], writes: ["answered"] },
    { id: "n_maya", kind: "pov", title: "Maya POV", col: 3, row: 0, reads: ["answered"] },
    { id: "n_luca", kind: "pov", title: "Luca POV", col: 3, row: 2, reads: ["answered"] },
    { id: "n_stay", kind: "intensity", title: "Stay quiet (low intensity)", col: 3, row: 1, writes: ["intensity"] },
    { id: "n_premium", kind: "premium", title: "Director's cut: the wiretap", col: 4, row: 0, reads: ["answered"], priceCoins: 40, locked: false },
    { id: "n_confront", kind: "beat", title: "The confrontation", col: 4, row: 2, reads: ["intensity"] },
    { id: "n_end_truth", kind: "ending", title: "Ending A: The truth", col: 5, row: 0, reads: ["trust", "answered"] },
    { id: "n_end_locked", kind: "locked", title: "Ending B: The betrayal (locked)", col: 5, row: 2, reads: ["trust"], priceCoins: 75, locked: true },
  ],
  edges: [
    { id: "e1", from: "n_ep1", to: "n_beat1" },
    { id: "e2", from: "n_beat1", to: "n_branch1" },
    { id: "e3", from: "n_branch1", to: "n_maya", choice: "Answer as Maya", timerSec: 8 },
    { id: "e4", from: "n_branch1", to: "n_luca", choice: "Answer as Luca", timerSec: 8 },
    { id: "e5", from: "n_branch1", to: "n_stay", choice: "Let it ring", timerSec: 8, isDefault: true },
    { id: "e6", from: "n_maya", to: "n_premium", choice: "Trace the signal" },
    { id: "e7", from: "n_luca", to: "n_confront" },
    { id: "e8", from: "n_stay", to: "n_confront" },
    { id: "e9", from: "n_premium", to: "n_end_truth" },
    { id: "e10", from: "n_confront", to: "n_end_truth", choice: "Expose the source" },
    { id: "e11", from: "n_confront", to: "n_end_locked", choice: "Bury it" },
  ],
  memoryVars: [
    { name: "trust", type: "int", note: "Viewer trust toward Maya, 0..10. Read by the branch and both endings." },
    { name: "answered", type: "bool", note: "Whether the viewer answered the intercept call." },
    { name: "intensity", type: "enum", note: "low / medium / high. Drives the intensity-dial cut selection." },
  ],
  canonRules: [
    { id: "c1", rule: "Every branch must have exactly one default-fallback edge for the choice timer." },
    { id: "c2", rule: "A locked ending must be reachable only after a premium cut or coin unlock." },
    { id: "c3", rule: "No ending may contradict an established memory variable (canon consistency)." },
  ],
};

// A second, simpler graph for The Director's Daughter so the route works for more than one series.
const STORY_DIRECTOR: StoryGraph = {
  seriesId: "ser_director",
  seriesTitle: "The Director's Daughter",
  version: 3,
  defaultFallbackNodeId: "d_wait",
  nodes: [
    { id: "d_ep3", kind: "episode", title: "Ep3 · The reveal", col: 0, row: 1, writes: ["suspicion"] },
    { id: "d_branch", kind: "branch", title: "Open the envelope?", col: 1, row: 1, reads: ["suspicion"], writes: ["opened"] },
    { id: "d_open", kind: "beat", title: "Read the letter", col: 2, row: 0, reads: ["opened"] },
    { id: "d_wait", kind: "intensity", title: "Wait (low intensity)", col: 2, row: 2, writes: ["intensity"] },
    { id: "d_end", kind: "ending", title: "Ending: The verdict", col: 3, row: 1, reads: ["suspicion"] },
  ],
  edges: [
    { id: "de1", from: "d_ep3", to: "d_branch" },
    { id: "de2", from: "d_branch", to: "d_open", choice: "Open it", timerSec: 6 },
    { id: "de3", from: "d_branch", to: "d_wait", choice: "Set it down", timerSec: 6, isDefault: true },
    { id: "de4", from: "d_open", to: "d_end" },
    { id: "de5", from: "d_wait", to: "d_end" },
  ],
  memoryVars: [
    { name: "suspicion", type: "int", note: "How suspicious the viewer is of the director." },
    { name: "opened", type: "bool", note: "Whether the envelope was opened." },
    { name: "intensity", type: "enum", note: "low / medium / high." },
  ],
  canonRules: [{ id: "dc1", rule: "Every branch must have a default-fallback edge for the choice timer." }],
};

const STORY_GRAPHS: Record<string, StoryGraph> = {
  ser_shadow: STORY_SHADOW,
  ser_director: STORY_DIRECTOR,
};

export function demoStoryGraph(seriesId: string): StoryGraph {
  return STORY_GRAPHS[seriesId] ?? STORY_SHADOW;
}

// A synthetic constraint-solver pass: confirms each branch has a default edge and flags the locked ending
// as a (benign) warning so the result shows a mix of ok + warning, never a fake all-green.
export function demoValidate(seriesId: string): StoryValidation {
  const g = demoStoryGraph(seriesId);
  const issues: StoryValidation["issues"] = [];
  const branchIds = g.nodes.filter((n) => n.kind === "branch").map((n) => n.id);
  for (const b of branchIds) {
    const hasDefault = g.edges.some((e) => e.from === b && e.isDefault);
    if (hasDefault) {
      issues.push({ severity: "ok", code: "default_fallback", message: `Branch ${b} has a default-fallback edge.`, nodeIds: [b] });
    } else {
      issues.push({ severity: "error", code: "missing_default", message: `Branch ${b} is missing a default-fallback edge for its choice timer.`, nodeIds: [b] });
    }
  }
  const locked = g.nodes.filter((n) => n.kind === "locked");
  for (const l of locked) {
    issues.push({ severity: "warning", code: "locked_reachability", message: `Locked ending ${l.id} is reachable only via a paid unlock. Confirm the upsell is wired.`, nodeIds: [l.id] });
  }
  issues.push({ severity: "ok", code: "canon", message: "No memory-variable contradictions detected across endings.", nodeIds: [] });
  return { ok: issues.every((i) => i.severity !== "error"), issues, checkedAt: new Date().toISOString() };
}

// A synthetic dry-run journey: walk the default path from the episode root, taking the first non-default
// choice where available, until an ending. Highlights the visited nodes for the diagram replay.
export function demoSimulate(seriesId: string, req: SimulateRequest): SimulateResult {
  const g = demoStoryGraph(seriesId);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const memory: Record<string, string | number | boolean> = { trust: 5, suspicion: 4 };
  const steps: SimulateResult["steps"] = [];
  const visited: string[] = [];

  // If an explicit path was requested, replay it; otherwise walk a default journey.
  if (req.path && req.path.length > 0) {
    for (const id of req.path) {
      const n = byId.get(id);
      if (!n) continue;
      visited.push(id);
      (n.writes ?? []).forEach((w) => (memory[w] = w === "answered" || w === "opened" ? true : memory[w] ?? 1));
      steps.push({ nodeId: id, title: n.title, rationale: "Replayed from requested path.", memory: { ...memory } });
    }
    return { visitedNodeIds: visited, steps, endingNodeId: visited.find((id) => byId.get(id)?.kind === "ending" || byId.get(id)?.kind === "locked") };
  }

  const root = g.nodes.find((n) => n.kind === "episode") ?? g.nodes[0];
  let cur: string | undefined = root.id;
  const guard = new Set<string>();
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    const n = byId.get(cur);
    if (!n) break;
    visited.push(cur);
    (n.writes ?? []).forEach((w) => (memory[w] = w === "answered" || w === "opened" ? true : (typeof memory[w] === "number" ? memory[w] : "high")));
    const outgoing = g.edges.filter((e) => e.from === cur);
    const taken = outgoing.find((e) => e.choice && !e.isDefault) ?? outgoing[0];
    steps.push({
      nodeId: cur,
      title: n.title,
      rationale: taken?.choice ? `Took choice "${taken.choice}"${taken.timerSec ? ` within the ${taken.timerSec}s timer` : ""}.` : n.kind === "episode" ? "Journey start." : "Followed the only outgoing path.",
      memory: { ...memory },
    });
    if (n.kind === "ending" || n.kind === "locked") break;
    cur = taken?.to;
  }
  const endingId = visited.find((id) => { const k = byId.get(id)?.kind; return k === "ending" || k === "locked"; });
  return { visitedNodeIds: visited, steps, endingNodeId: endingId };
}

/* -------------------------------- Media factory ------------------------------- */
export const DEMO_MEDIA_JOBS: MediaFactoryJobs = {
  jobs: [
    {
      jobId: "job_shadow_ep3",
      seriesId: "ser_shadow",
      seriesTitle: "Shadow Signal",
      episodeTitle: "Ep3 · The wiretap",
      state: "running",
      projectedCost: 1840,
      budget: 2500,
      overBudget: false,
      stages: [
        { name: "Ingest + probe", status: "done", cost: 40, assetId: "ast_ing_9921" },
        { name: "Encode HLS (9:16 + 16:9)", status: "done", cost: 320, assetId: "ast_hls_9922" },
        { name: "Captions (CWI, EN)", status: "done", cost: 180, assetId: "ast_cc_9923" },
        { name: "Audio description (EN)", status: "running", cost: 260 },
        { name: "Sign track (ASL)", status: "queued", cost: 540 },
        { name: "Dubs (ES, PT)", status: "queued", cost: 380 },
        { name: "QA + provenance (C2PA)", status: "queued", cost: 120 },
      ],
    },
    {
      jobId: "job_director_ep4",
      seriesId: "ser_director",
      seriesTitle: "The Director's Daughter",
      episodeTitle: "Ep4 · The verdict",
      state: "needs_approval",
      projectedCost: 3120,
      budget: 2500,
      overBudget: true,
      stages: [
        { name: "Ingest + probe", status: "done", cost: 40, assetId: "ast_ing_7741" },
        { name: "Encode HLS (9:16 + 16:9)", status: "done", cost: 360, assetId: "ast_hls_7742" },
        { name: "Captions (CWI, EN)", status: "done", cost: 200, assetId: "ast_cc_7743" },
        { name: "Audio description (EN)", status: "blocked", cost: 280, detail: "Over budget: awaiting approval to proceed." },
        { name: "Sign track (ASL + BSL)", status: "blocked", cost: 980 },
        { name: "Dubs (ES, PT, FR)", status: "blocked", cost: 740 },
        { name: "QA + provenance (C2PA)", status: "blocked", cost: 120 },
      ],
    },
    {
      jobId: "job_vow_ep2",
      seriesId: "ser_vow",
      seriesTitle: "A Vow in Code",
      episodeTitle: "Ep2 · The proposal",
      state: "failed",
      projectedCost: 1460,
      budget: 2500,
      overBudget: false,
      stages: [
        { name: "Ingest + probe", status: "done", cost: 40, assetId: "ast_ing_5511" },
        { name: "Encode HLS (9:16 + 16:9)", status: "failed", cost: 320, detail: "Source master corrupt at 00:14:22. Re-upload required." },
        { name: "Captions (CWI, EN)", status: "skipped", cost: 0 },
        { name: "Audio description (EN)", status: "skipped", cost: 0 },
        { name: "Sign track (ASL)", status: "skipped", cost: 0 },
        { name: "QA + provenance (C2PA)", status: "skipped", cost: 0 },
      ],
    },
    {
      jobId: "job_heiress_ep5",
      seriesId: "ser_heiress",
      seriesTitle: "The Hidden Heiress",
      episodeTitle: "Ep5 · The inheritance",
      state: "done",
      projectedCost: 1980,
      budget: 2500,
      overBudget: false,
      stages: [
        { name: "Ingest + probe", status: "done", cost: 40, assetId: "ast_ing_3301" },
        { name: "Encode HLS (9:16 + 16:9)", status: "done", cost: 340, assetId: "ast_hls_3302" },
        { name: "Captions (CWI, EN)", status: "done", cost: 190, assetId: "ast_cc_3303" },
        { name: "Audio description (EN)", status: "done", cost: 270, assetId: "ast_ad_3304" },
        { name: "Sign track (ASL)", status: "done", cost: 560, assetId: "ast_sign_3305" },
        { name: "Dubs (ES, PT)", status: "done", cost: 360, assetId: "ast_dub_3306" },
        { name: "QA + provenance (C2PA)", status: "done", cost: 120, assetId: "ast_c2pa_3307" },
      ],
    },
  ],
};

/* ------------------------------ Accessibility -------------------------------- */
export const DEMO_ACCESSIBILITY: AdminAccessibility = {
  readiness: [
    { seriesId: "ser_shadow", seriesTitle: "Shadow Signal", score: 100, blockers: [] },
    { seriesId: "ser_heiress", seriesTitle: "The Hidden Heiress", score: 100, blockers: [] },
    { seriesId: "ser_vow", seriesTitle: "A Vow in Code", score: 92, blockers: ["Sign track (ASL) Ep2 awaiting Deaf review"] },
    {
      seriesId: "ser_director",
      seriesTitle: "The Director's Daughter",
      score: 64,
      blockers: ["Audio description (EN) Ep3 missing", "Sign track (ASL) Ep3 in QA", "Dub (PT) Ep3 drafted, not reviewed"],
    },
  ],
  perTrack: [
    { seriesId: "ser_shadow", seriesTitle: "Shadow Signal", track: "captions", language: "EN", status: "ready", coverage: 100 },
    { seriesId: "ser_shadow", seriesTitle: "Shadow Signal", track: "audio_description", language: "EN", status: "ready", coverage: 100 },
    { seriesId: "ser_shadow", seriesTitle: "Shadow Signal", track: "sign", language: "ASL", status: "ready", coverage: 100 },
    { seriesId: "ser_shadow", seriesTitle: "Shadow Signal", track: "dub", language: "ES", status: "ready", coverage: 100 },
    { seriesId: "ser_director", seriesTitle: "The Director's Daughter", track: "captions", language: "EN", status: "ready", coverage: 100 },
    { seriesId: "ser_director", seriesTitle: "The Director's Daughter", track: "audio_description", language: "EN", status: "missing", coverage: 0 },
    { seriesId: "ser_director", seriesTitle: "The Director's Daughter", track: "sign", language: "ASL", status: "in_qa", coverage: 70 },
    { seriesId: "ser_director", seriesTitle: "The Director's Daughter", track: "dub", language: "PT", status: "drafted", coverage: 45 },
    { seriesId: "ser_vow", seriesTitle: "A Vow in Code", track: "captions", language: "EN", status: "ready", coverage: 100 },
    { seriesId: "ser_vow", seriesTitle: "A Vow in Code", track: "sign", language: "ASL", status: "in_qa", coverage: 88 },
  ],
  reviewQueue: [
    { id: "rv_1", seriesTitle: "A Vow in Code", episodeTitle: "Ep2 · The proposal", track: "sign", language: "ASL", reviewer: "Deaf review panel", submittedAt: "2026-06-17T14:20:00Z" },
    { id: "rv_2", seriesTitle: "The Director's Daughter", episodeTitle: "Ep3 · The reveal", track: "sign", language: "ASL", reviewer: "Deaf review panel", submittedAt: "2026-06-17T09:05:00Z" },
    { id: "rv_3", seriesTitle: "The Director's Daughter", episodeTitle: "Ep3 · The reveal", track: "dub", language: "PT", reviewer: "Native PT reviewer", submittedAt: "2026-06-16T18:40:00Z" },
  ],
};

/* ---------------------------- Brand integration ------------------------------ */
// Brand tables are NOT in the hosted schema yet. Per the build gate, the brand surfaces render a REAL empty
// state (no campaigns yet) plus the content/ad firewall note, NOT fabricated rows. So every brand fixture is
// deliberately empty: the demo fallback shows the same honest empty state the live (currently empty)
// endpoints would. No em dashes.
export const DEMO_BRANDS: AdminBrands = { brands: [] };
export const DEMO_CAMPAIGNS: AdminCampaigns = { campaigns: [] };
export const DEMO_PLACEMENTS: AdminPlacements = { placements: [] };

/* ---------------------------------- Users ------------------------------------ */
// Synthetic, minimized accounts. Handles only (no legal names), coarse region, coin balance, tier, and
// subscription. No personal/biometric data. The detail view's history is minimized + privacy-gated.
export const DEMO_USERS: AdminUsers = {
  users: [
    { id: "usr_8821", handle: "@mara.k", tier: "premium", subscription: "active", balanceCoins: 1240, region: "NA", createdAt: "2025-11-02" },
    { id: "usr_8822", handle: "@deafcinephile", tier: "plus", subscription: "active", balanceCoins: 380, region: "EU", createdAt: "2026-01-14" },
    { id: "usr_8823", handle: "@luca_watches", tier: "free", subscription: "none", balanceCoins: 60, region: "LATAM", createdAt: "2026-03-20" },
    { id: "usr_8824", handle: "@signfirst", tier: "premium", subscription: "trialing", balanceCoins: 940, region: "NA", createdAt: "2026-05-01" },
    { id: "usr_8825", handle: "@nightowl22", tier: "plus", subscription: "past_due", balanceCoins: 0, region: "APAC", createdAt: "2026-02-09" },
    { id: "usr_8826", handle: "@quiet.viewer", tier: "free", subscription: "canceled", balanceCoins: 15, region: "EU", createdAt: "2025-09-30" },
  ],
};

function demoUserDetail(id: string): UserDetail | undefined {
  const user = DEMO_USERS.users.find((u) => u.id === id);
  if (!user) return undefined;
  return {
    user,
    a11yDefaults: [
      { label: "Captions", value: "On (CWI, large)" },
      { label: "Audio description", value: user.tier === "free" ? "Off" : "On" },
      { label: "Sign track", value: "ASL preferred" },
      { label: "Language", value: user.region === "LATAM" ? "ES" : "EN" },
      { label: "Reduce motion", value: "On" },
    ],
    purchaseHistory: [
      { label: "Coin pack", detail: "500 coins", at: "2026-06-10" },
      { label: "Premium cut unlock", detail: "Shadow Signal · Director's cut", at: "2026-06-11" },
    ],
    watchHistory: [
      { label: "Shadow Signal", detail: "Ep1 completed · Maya POV", at: "2026-06-11" },
      { label: "The Hidden Heiress", detail: "Ep5 started", at: "2026-06-12" },
    ],
    branchHistory: [
      { label: "Shadow Signal Ep1", detail: 'Choice "Answer as Maya"', at: "2026-06-11" },
      { label: "Shadow Signal Ep1", detail: 'Choice "Trace the signal"', at: "2026-06-11" },
    ],
    downloads: [{ label: "Offline download", detail: "The Hidden Heiress Ep5", at: "2026-06-12" }],
    referrals: [{ label: "Referred", detail: "1 friend joined", at: "2026-05-22" }],
    sessions: [
      { device: "iOS app", lastSeen: "2026-06-12T20:14:00Z", ip: "redacted" },
      { device: "Web (Chrome)", lastSeen: "2026-06-10T11:02:00Z", ip: "redacted" },
    ],
  };
}
export { demoUserDetail };

/* --------------------------------- Creators ---------------------------------- */
export const DEMO_CREATORS: AdminCreators = {
  creators: [
    { id: "cre_201", name: "Avalon Studios", kyc: "verified", earningsUsd: 482000, contentCount: 3, payout: "paid", strikes: "clear", brandEligible: true },
    { id: "cre_202", name: "Rosa Marin", kyc: "verified", earningsUsd: 128400, contentCount: 1, payout: "scheduled", strikes: "clear", brandEligible: true },
    { id: "cre_203", name: "North Pivot Films", kyc: "in_review", earningsUsd: 0, contentCount: 1, payout: "pending", strikes: "warning", brandEligible: false },
    { id: "cre_204", name: "Kemi Adeyemi", kyc: "verified", earningsUsd: 71250, contentCount: 1, payout: "on_hold", strikes: "clear", brandEligible: false },
  ],
};

function demoCreatorDetail(id: string): CreatorDetail | undefined {
  const creator = DEMO_CREATORS.creators.find((c) => c.id === id);
  if (!creator) return undefined;
  return {
    creator,
    split: { creatorPct: 70, platformPct: 30 },
    contract: { id: `ct_${creator.id}`, signedAt: "2025-10-12", term: "24 months, auto-renew" },
    library: (
      [
        { id: "ser_shadow", title: "Shadow Signal", status: "live", variants: 486 },
        { id: "ser_heiress", title: "The Hidden Heiress", status: "live", variants: 540 },
      ] as CreatorDetail["library"]
    ).slice(0, creator.contentCount),
    rightsFiles: [
      { label: "Likeness consent (cast)", status: "on_file", updatedAt: "2025-10-12" },
      { label: "Music sync license", status: creator.brandEligible ? "on_file" : "missing", updatedAt: "2026-01-04" },
      { label: "C2PA provenance manifest", status: "on_file", updatedAt: "2026-06-01" },
    ],
    moderation:
      creator.strikes === "warning"
        ? [{ label: "Content advisory: unverified source clip", at: "2026-05-18", severity: "warning" as const }]
        : [{ label: "No moderation actions on record", at: "2025-10-12", severity: "info" as const }],
    earnings: [
      { source: "Coins", amountUsd: Math.round(creator.earningsUsd * 0.62) },
      { source: "Subscriptions", amountUsd: Math.round(creator.earningsUsd * 0.28) },
      { source: "Ads", amountUsd: Math.round(creator.earningsUsd * 0.1) },
    ],
  };
}
export { demoCreatorDetail };

/* ------------------------------- Monetization -------------------------------- */
// Section 10. Synthetic pricing-rules config + display-only reward weights. Prices are illustrative; the
// ledger / Stripe is the real source. Stripe is TEST. No live charges. No personal/biometric data.
export const DEMO_MONETIZATION: AdminMonetization = {
  stripeMode: "test",
  rules: [
    { id: "rule_pack_s", kind: "credit_pack", name: "Starter coin pack", price: "100 coins · $0.99", country: "all", platform: "all", contentType: "all", cohort: "all", status: "active", note: "Entry pack" },
    { id: "rule_pack_m", kind: "credit_pack", name: "Standard coin pack", price: "500 coins · $3.99", country: "all", platform: "all", contentType: "all", cohort: "all", status: "active" },
    { id: "rule_pack_l", kind: "credit_pack", name: "Premium coin pack", price: "1,200 coins · $8.99", country: "all", platform: "all", contentType: "all", cohort: "all", status: "active", note: "Best value" },
    { id: "rule_sub_plus", kind: "subscription", name: "Plus monthly", price: "$6.99 / mo", country: "all", platform: "all", contentType: "all", cohort: "all", status: "active" },
    { id: "rule_sub_prem", kind: "subscription", name: "Premium monthly", price: "$12.99 / mo", country: "all", platform: "all", contentType: "all", cohort: "all", status: "active" },
    { id: "rule_trial", kind: "trial", name: "Premium 7-day trial", price: "Free · 7 days", country: "all", platform: "all", contentType: "all", cohort: "new_signups", status: "active", note: "Converts to Premium monthly" },
    { id: "rule_rewarded", kind: "rewarded_ad", name: "Rewarded ad unlock", price: "1 ad = 20 coins", country: "all", platform: "android", contentType: "all", cohort: "free_tier", status: "active", note: "Free-tier only; capped 3/day" },
    { id: "rule_premium_cut", kind: "premium_cut", name: "Director's cut unlock", price: "120 coins", country: "all", platform: "all", contentType: "series", cohort: "all", status: "active" },
    { id: "rule_alt_ending", kind: "alt_ending", name: "Alternate ending", price: "80 coins", country: "all", platform: "all", contentType: "ending", cohort: "all", status: "active" },
    { id: "rule_pov", kind: "pov", name: "Extra POV track", price: "60 coins", country: "all", platform: "all", contentType: "branch", cohort: "all", status: "active" },
    { id: "rule_intensity", kind: "intensity", name: "Intensity variant", price: "40 coins", country: "all", platform: "all", contentType: "episode", cohort: "all", status: "active" },
    { id: "rule_promo", kind: "promo_code", name: "Promo WELCOME20", price: "20% off first pack", country: "all", platform: "all", contentType: "all", cohort: "all", status: "scheduled", note: "Starts 2026-07-01" },
    { id: "rule_regional_in", kind: "regional", name: "Regional pricing (IN)", price: "Premium $4.99 / mo", country: "IN", platform: "all", contentType: "all", cohort: "all", status: "active", note: "PPP-adjusted" },
    { id: "rule_regional_br", kind: "regional", name: "Regional pricing (BR)", price: "Premium R$24.90 / mo", country: "BR", platform: "all", contentType: "all", cohort: "all", status: "active", note: "PPP-adjusted" },
    { id: "rule_vat_eu", kind: "tax_vat", name: "EU VAT", price: "+19-27% by member state", country: "EU", platform: "all", contentType: "all", cohort: "all", status: "active", note: "Applied at checkout" },
    { id: "rule_refund", kind: "refund", name: "Refund window", price: "14 days · unused coins", country: "EU", platform: "all", contentType: "all", cohort: "all", status: "active", note: "Statutory" },
    { id: "rule_chargeback", kind: "chargeback", name: "Chargeback policy", price: "Account hold on dispute", country: "all", platform: "all", contentType: "all", cohort: "all", status: "active" },
  ],
  // DISPLAY ONLY. Changing any of these is a founder sign-off, never an operator action. No edit control.
  rewardWeights: [
    { key: "w_completion", label: "Completion", value: "0.34", signal: "episode_completed" },
    { key: "w_replay", label: "Replay / rewatch", value: "0.18", signal: "branch_replayed" },
    { key: "w_branch", label: "Branch engagement", value: "0.21", signal: "branch_decision" },
    { key: "w_accessibility", label: "Accessibility usage", value: "0.15", signal: "a11y_track_used" },
    { key: "w_satisfaction", label: "Reported satisfaction", value: "0.12", signal: "post_watch_rating" },
  ],
};

/* --------------------------------- Analytics --------------------------------- */
// Section 11. A dimension-scoped report fixture builder. Every counterfactual lift is a band, never a point.
const ANALYTICS_REPORTS: Record<AnalyticsDim, AnalyticsReport> = {
  series: {
    dim: "series",
    title: "By series",
    columns: ["Series", "Watch starts", "Completion", "Adaptive lift"],
    kpis: [
      { key: "starts", label: "Watch starts", value: "9.1M" },
      { key: "completion", label: "Avg completion", value: "78.4%" },
      { key: "lift", label: "Adaptive completion lift", value: "band", band: { low: 6, high: 17, center: 11, label: "Estimated completion lift 6% to 17%" } },
    ],
    rows: [
      { label: "Shadow Signal", value: "4.2M", secondary: "81.0%", band: { low: 8, high: 19, center: 13, label: "Lift 8% to 19%" } },
      { label: "The Hidden Heiress", value: "3.0M", secondary: "76.5%", band: { low: 5, high: 15, center: 10, label: "Lift 5% to 15%" } },
      { label: "North Pivot", value: "1.9M", secondary: "72.1%", band: { low: 3, high: 12, center: 7, label: "Lift 3% to 12%" } },
    ],
  },
  episode: {
    dim: "episode",
    title: "By episode",
    columns: ["Episode", "Starts", "Drop-off"],
    kpis: [{ key: "ep", label: "Episodes tracked", value: "42" }, { key: "drop", label: "Median drop-off", value: "11.2%" }],
    rows: [
      { label: "Shadow Signal Ep1", value: "1.4M", secondary: "7.1%" },
      { label: "Shadow Signal Ep2", value: "1.2M", secondary: "9.8%" },
      { label: "Hidden Heiress Ep5", value: "0.9M", secondary: "14.0%" },
    ],
  },
  branch: {
    dim: "branch",
    title: "By branch",
    columns: ["Branch decision", "Decisions", "Take rate", "Engagement lift"],
    kpis: [
      { key: "dec", label: "Branch decisions", value: "4.4M" },
      { key: "lift", label: "Branch engagement lift", value: "band", band: { low: 9, high: 22, center: 15, label: "Engagement lift 9% to 22%" } },
    ],
    rows: [
      { label: 'Shadow Ep1 · "Answer as Maya"', value: "1.1M", secondary: "58%", band: { low: 10, high: 24, center: 16, label: "Lift 10% to 24%" } },
      { label: 'Shadow Ep1 · "Trace the signal"', value: "0.8M", secondary: "42%", band: { low: 6, high: 18, center: 12, label: "Lift 6% to 18%" } },
    ],
  },
  ending: {
    dim: "ending",
    title: "By ending",
    columns: ["Ending", "Reached", "Unlock rate"],
    kpis: [{ key: "endings", label: "Endings", value: "12" }, { key: "premium", label: "Premium unlock rate", value: "9.4%" }],
    rows: [
      { label: "Shadow Signal · Canon ending", value: "61%", secondary: "free" },
      { label: "Shadow Signal · Alternate ending", value: "9.4%", secondary: "80 coins" },
    ],
  },
  a11y: {
    dim: "a11y",
    title: "By accessibility track",
    columns: ["Track", "Sessions using", "Share"],
    kpis: [{ key: "usage", label: "Accessibility usage", value: "41.6%" }, { key: "sign", label: "Sign-track sessions", value: "312k" }],
    rows: [
      { label: "Captions (CWI)", value: "1.6M", secondary: "33.0%" },
      { label: "Audio description", value: "420k", secondary: "8.7%" },
      { label: "Sign language", value: "312k", secondary: "6.4%" },
    ],
  },
  language: {
    dim: "language",
    title: "By language",
    columns: ["Language", "Sessions", "Completion"],
    kpis: [{ key: "langs", label: "Languages", value: "18" }, { key: "intl", label: "Non-EN share", value: "47%" }],
    rows: [
      { label: "EN", value: "2.6M", secondary: "79%" },
      { label: "ES", value: "0.9M", secondary: "77%" },
      { label: "PT", value: "0.5M", secondary: "75%" },
    ],
  },
  monetization: {
    dim: "monetization",
    title: "Monetization",
    columns: ["Source", "Revenue", "Share", "Adaptive lift"],
    kpis: [
      { key: "rev", label: "Revenue", value: "$1.84M" },
      { key: "lift", label: "Adaptive revenue lift", value: "band", band: { low: 8, high: 19, center: 13, label: "Revenue lift 8% to 19%" } },
    ],
    rows: [
      { label: "Coins", value: "$1.02M", secondary: "55%", band: { low: 9, high: 21, center: 14, label: "Lift 9% to 21%" } },
      { label: "Subscriptions", value: "$0.46M", secondary: "25%" },
      { label: "Ads", value: "$0.24M", secondary: "13%" },
      { label: "Brand", value: "$0.12M", secondary: "7%" },
    ],
  },
  funnel: {
    dim: "funnel",
    title: "Acquisition funnel",
    columns: ["Step", "Users", "Step conversion"],
    kpis: [{ key: "top", label: "Top of funnel", value: "5.0M" }, { key: "conv", label: "Install to subscribe", value: "3.1%" }],
    rows: [
      { label: "App store visit", value: "5.0M", secondary: "100%" },
      { label: "Install", value: "1.6M", secondary: "32%" },
      { label: "First watch", value: "1.2M", secondary: "75%" },
      { label: "Subscribe", value: "156k", secondary: "13%" },
    ],
  },
  cohorts: {
    dim: "cohorts",
    title: "Cohorts",
    columns: ["Signup cohort", "Size", "W4 retention"],
    kpis: [{ key: "best", label: "Best W4 retention", value: "38%" }],
    rows: [
      { label: "2026-03", value: "210k", secondary: "31%" },
      { label: "2026-04", value: "248k", secondary: "34%" },
      { label: "2026-05", value: "291k", secondary: "38%" },
    ],
  },
  retention: {
    dim: "retention",
    title: "Retention",
    columns: ["Window", "Retained", "Rate"],
    kpis: [{ key: "d1", label: "D1 retention", value: "52%" }, { key: "d30", label: "D30 retention", value: "27%" }],
    rows: [
      { label: "D1", value: "830k", secondary: "52%" },
      { label: "D7", value: "560k", secondary: "35%" },
      { label: "D30", value: "432k", secondary: "27%" },
    ],
  },
  churn: {
    dim: "churn",
    title: "Churn",
    columns: ["Segment", "Churned", "Monthly churn"],
    kpis: [{ key: "churn", label: "Blended monthly churn", value: "5.8%" }],
    rows: [
      { label: "Plus", value: "9.1k", secondary: "6.4%" },
      { label: "Premium", value: "4.2k", secondary: "3.9%" },
    ],
  },
  ltv: {
    dim: "ltv",
    title: "Lifetime value",
    columns: ["Cohort", "LTV (band)", "Payback"],
    kpis: [
      { key: "ltv", label: "Blended LTV (estimated)", value: "band", band: { low: 28, high: 64, center: 44, label: "LTV $28 to $64" } },
    ],
    rows: [
      { label: "Premium · NA", value: "$44 to $78", secondary: "4.1 mo", band: { low: 44, high: 78, center: 58, label: "LTV $44 to $78" } },
      { label: "Plus · EU", value: "$22 to $48", secondary: "6.3 mo", band: { low: 22, high: 48, center: 33, label: "LTV $22 to $48" } },
    ],
  },
  cac: {
    dim: "cac",
    title: "Acquisition cost",
    columns: ["Channel", "CAC", "Installs"],
    kpis: [{ key: "cac", label: "Blended CAC", value: "$3.40" }],
    rows: [
      { label: "Paid social", value: "$3.80", secondary: "620k" },
      { label: "Referral", value: "$0.90", secondary: "210k" },
      { label: "Search", value: "$4.20", secondary: "180k" },
    ],
  },
  content: {
    dim: "content",
    title: "Content overview",
    columns: ["Metric", "Value", "Trend"],
    kpis: [{ key: "titles", label: "Live titles", value: "3" }, { key: "variants", label: "Variants", value: "1,566" }],
    rows: [
      { label: "Live series", value: "3", secondary: "+0" },
      { label: "Variants produced", value: "1,566", secondary: "+212 / 28d" },
      { label: "Avg a11y coverage", value: "98%", secondary: "+1pp" },
    ],
  },
};
function demoAnalytics(dim: AnalyticsDim): AnalyticsReport {
  return ANALYTICS_REPORTS[dim] ?? ANALYTICS_REPORTS.series;
}
export { demoAnalytics };

/* ---------------------------------- Growth ----------------------------------- */
// Section 12. Synthetic UA surface. Win-rates and LTV are bands (estimated), never points.
export const DEMO_GROWTH: AdminGrowth = {
  creativeTests: [
    { id: "arm_a", name: "Hook: deaf-led trailer", channel: "Paid social", impressions: 1_240_000, winRate: { low: 38, high: 54, center: 46, label: "Win-rate 38% to 54%" }, allocationPct: 44, status: "live" },
    { id: "arm_b", name: "Hook: branch-the-story", channel: "Paid social", impressions: 980_000, winRate: { low: 30, high: 47, center: 38, label: "Win-rate 30% to 47%" }, allocationPct: 31, status: "live" },
    { id: "arm_c", name: "Hook: unlock the ending", channel: "Search", impressions: 410_000, winRate: { low: 18, high: 33, center: 25, label: "Win-rate 18% to 33%" }, allocationPct: 17, status: "paused" },
    { id: "arm_d", name: "Hook: cinematic montage", channel: "Search", impressions: 120_000, winRate: { low: 6, high: 16, center: 11, label: "Win-rate 6% to 16%" }, allocationPct: 8, status: "exhausted" },
  ],
  channels: [
    { id: "ch_social_na", channel: "Paid social", cohort: "NA", cacUsd: 3.8, ltvBand: { low: 44, high: 78, center: 58, label: "LTV $44 to $78" }, paybackMonths: 4.1, installs: 620_000 },
    { id: "ch_ref_global", channel: "Referral", cohort: "Global", cacUsd: 0.9, ltvBand: { low: 36, high: 70, center: 50, label: "LTV $36 to $70" }, paybackMonths: 1.2, installs: 210_000 },
    { id: "ch_search_eu", channel: "Search", cohort: "EU", cacUsd: 4.2, ltvBand: { low: 22, high: 48, center: 33, label: "LTV $22 to $48" }, paybackMonths: 6.3, installs: 180_000 },
  ],
  referral: {
    invitesSent: 412_000,
    invitesAccepted: 138_000,
    acceptRatePct: 33.5,
    kFactor: 0.41,
    kFactorBand: { low: 32, high: 52, center: 41, label: "k-factor projection 0.32 to 0.52" },
    funnel: [
      { label: "Invites sent", value: 412_000 },
      { label: "Accepted", value: 138_000 },
      { label: "Activated", value: 96_000 },
      { label: "Retained (W4)", value: 41_000 },
    ],
  },
};

/* -------------------------------- Moderation --------------------------------- */
// Section 13. The social tables do not exist yet, so the live queue is EMPTY. The demo fixture is also
// EMPTY so the console shows the same honest empty state the (currently empty) live endpoint would, plus the
// "scanner unwired" banner. We do NOT fabricate flagged/clean items: a fabricated clean verdict is a hard
// gate violation, and there are no real items to scan yet. The POLICY fixture is real config (age-gating +
// rate limits + the unwired-scanner status), which is safe to show because it is policy, not content. No em
// dashes.
export const DEMO_MODERATION_QUEUE: ModerationQueue = { items: [] };

export const DEMO_MODERATION_POLICY: ModerationPolicy = {
  ageGates: [
    { id: "ag_minors_mature", label: "Minors and mature community", rule: "Accounts flagged as minors are blocked from mature community spaces (comments, character feeds on mature titles).", enforced: true },
    { id: "ag_no_parasocial", label: "No romantic or parasocial overlap", rule: "Romantic or parasocial character interactions are never offered to or shown for minor accounts; community and character-companion surfaces do not overlap for minors.", enforced: true },
    { id: "ag_dob_gate", label: "Age verification gate", rule: "Community write access requires a passed age gate; unverified accounts are read-only in social surfaces.", enforced: true },
  ],
  rateLimits: [
    { id: "rl_comments", scope: "Comments", limit: "5 / min", appliesTo: "all" },
    { id: "rl_comments_new", scope: "Comments", limit: "2 / min", appliesTo: "new accounts (< 48h)" },
    { id: "rl_posts", scope: "Character-feed posts", limit: "20 / day", appliesTo: "all" },
    { id: "rl_reports", scope: "Reports filed", limit: "30 / day", appliesTo: "all" },
  ],
  // The scanning interface is a REAL seam wired to a provider later. While unwired, every item's verdict is
  // pending_provider; nothing is ever marked clean by fabrication.
  scanProvider: {
    wired: false,
    note: "CSAM/illegal-content and harassment scanning is a real interface wired to a provider in a later wave. While unwired, every item's verdict is pending_provider. No item is ever auto-marked clean.",
  },
};

/* ---------------------------- Trust / consent ------------------------------- */
// Section 14 (the moat). The consent ledger is MINIMIZED: pseudonymous subject refs, scope/status/expiry and
// residency only. NO biometric template, raw birthdate, legal name, or any full PII lives here; the full
// record stays on the sovereign plane and the console only ever sees this projection. Synthetic. No em
// dashes.
export const DEMO_TRUST_CONSENT: ConsentLedger = {
  records: [
    { id: "cn_1", subjectRef: "subj_7f3a", scope: "likeness", status: "active", grantedAt: "2025-10-12", expiresAt: "2027-10-12", residency: "EU", sovereign: true },
    { id: "cn_2", subjectRef: "subj_7f3a", scope: "voice", status: "active", grantedAt: "2025-10-12", expiresAt: "2027-10-12", residency: "EU", sovereign: true },
    { id: "cn_3", subjectRef: "subj_91bd", scope: "biometric", status: "expiring", grantedAt: "2024-12-01", expiresAt: "2026-07-01", residency: "CH", sovereign: true },
    { id: "cn_4", subjectRef: "subj_22e0", scope: "data_processing", status: "active", grantedAt: "2026-01-14", residency: "EU", sovereign: true },
    { id: "cn_5", subjectRef: "subj_4c7f", scope: "marketing", status: "revoked", grantedAt: "2025-09-30", residency: "US", sovereign: true },
    { id: "cn_6", subjectRef: "subj_91bd", scope: "likeness", status: "expired", grantedAt: "2023-06-01", expiresAt: "2025-06-01", residency: "CH", sovereign: true },
  ],
  residency: { eu: 3, ch: 2, us: 1 },
};

export const DEMO_TRUST_PROVENANCE: ProvenanceLedger = {
  records: [
    { id: "pv_1", assetTitle: "Shadow Signal · Ep1 · Maya POV · EN", status: "verified", signer: "Avalon Studios", signedAt: "2026-06-01", manifestId: "c2pa:9a21f0" },
    { id: "pv_2", assetTitle: "The Hidden Heiress · Ep5 · EN", status: "verified", signer: "Avalon Studios", signedAt: "2026-05-18", manifestId: "c2pa:7c0b44" },
    { id: "pv_3", assetTitle: "The Director's Daughter · Ep3 · EN", status: "pending", signer: "North Pivot Films" },
    { id: "pv_4", assetTitle: "A Vow in Code · Ep2 · sign track (ASL)", status: "unsigned" },
    { id: "pv_5", assetTitle: "Shadow Signal · Ep2 · trailer cut", status: "failed", signer: "Avalon Studios", signedAt: "2026-06-09", manifestId: "c2pa:invalid" },
  ],
};

export const DEMO_TRUST_GDPR: GdprQueue = {
  requests: [
    { id: "gdpr_1", kind: "export", subjectRef: "subj_22e0", state: "in_progress", receivedAt: "2026-06-15", dueBy: "2026-07-15" },
    { id: "gdpr_2", kind: "delete", subjectRef: "subj_4c7f", state: "awaiting_verification", receivedAt: "2026-06-14", dueBy: "2026-07-14" },
    { id: "gdpr_3", kind: "rectify", subjectRef: "subj_91bd", state: "received", receivedAt: "2026-06-17", dueBy: "2026-07-17" },
    { id: "gdpr_4", kind: "export", subjectRef: "subj_7f3a", state: "completed", receivedAt: "2026-05-20", dueBy: "2026-06-19" },
  ],
};

/* ---------------------------------- Finance ---------------------------------- */
// Section 15. Synthetic double-entry ledger + revenue + 70/30 payouts + FinOps. Coin-denominated; USD
// equivalents are illustrative. Stripe is TEST (no live charges). Refs are pseudonymous, never raw PII. No
// em dashes.
function payoutRow(creatorId: string, creatorName: string, grossUsd: number, status: AdminFinance["payouts"][number]["status"], runId?: string): AdminFinance["payouts"][number] {
  const creatorShareUsd = Math.round(grossUsd * 0.7);
  return {
    creatorId,
    creatorName,
    grossUsd,
    creatorPct: 70,
    platformPct: 30,
    creatorShareUsd,
    platformShareUsd: grossUsd - creatorShareUsd,
    status,
    runId,
  };
}

export const DEMO_FINANCE: AdminFinance = {
  stripeMode: "test",
  ledger: [
    { id: "tx_10231", at: "2026-06-17T20:14:00Z", kind: "purchase", debitAccount: "stripe_clearing", creditAccount: "user_wallet", amountCoins: 500, amountUsd: 3.99, ref: "subj_22e0" },
    { id: "tx_10232", at: "2026-06-17T20:15:10Z", kind: "spend", debitAccount: "user_wallet", creditAccount: "platform_revenue", amountCoins: 120, amountUsd: 0.96, ref: "subj_22e0" },
    { id: "tx_10233", at: "2026-06-17T21:02:00Z", kind: "credit", debitAccount: "promo_reserve", creditAccount: "user_wallet", amountCoins: 20, amountUsd: 0.0, ref: "subj_91bd" },
    { id: "tx_10234", at: "2026-06-17T22:40:00Z", kind: "refund", debitAccount: "platform_revenue", creditAccount: "stripe_clearing", amountCoins: 100, amountUsd: 0.99, ref: "subj_4c7f" },
    { id: "tx_10235", at: "2026-06-18T08:11:00Z", kind: "payout", debitAccount: "creator_payable", creditAccount: "stripe_payout_clearing", amountCoins: 0, amountUsd: 8400.0, ref: "cre_201" },
    { id: "tx_10236", at: "2026-06-18T09:30:00Z", kind: "chargeback", debitAccount: "platform_revenue", creditAccount: "stripe_clearing", amountCoins: 0, amountUsd: 3.99, ref: "subj_4c7f" },
  ],
  revenue: [
    { source: "Coins", market: "NA", amountUsd: 612_000, sharePct: 33 },
    { source: "Coins", market: "EU", amountUsd: 408_000, sharePct: 22 },
    { source: "Subscriptions", market: "all", amountUsd: 460_000, sharePct: 25 },
    { source: "Ads", market: "all", amountUsd: 240_000, sharePct: 13 },
    { source: "Brand", market: "all", amountUsd: 120_000, sharePct: 7 },
  ],
  payouts: [
    payoutRow("cre_201", "Avalon Studios", 688_571, "paid", "run_2026_06"),
    payoutRow("cre_202", "Rosa Marin", 183_428, "scheduled", "run_2026_06"),
    payoutRow("cre_203", "North Pivot Films", 0, "pending"),
    payoutRow("cre_204", "Kemi Adeyemi", 101_785, "on_hold"),
  ],
  finops: [
    { line: "GPU compute (produce DAG)", spendUsd: 142_000, capUsd: 180_000, overCap: false },
    { line: "Vendor APIs (captions/dub/sign)", spendUsd: 61_000, capUsd: 80_000, overCap: false },
    { line: "Storage + CDN egress", spendUsd: 94_000, capUsd: 85_000, overCap: true },
    { line: "LLM inference (cut selection)", spendUsd: 38_000, capUsd: 60_000, overCap: false },
  ],
  margins: [
    { titleId: "ser_shadow", title: "Shadow Signal", revenueUsd: 980_000, costUsd: 214_000, marginPct: 78 },
    { titleId: "ser_heiress", title: "The Hidden Heiress", revenueUsd: 640_000, costUsd: 196_000, marginPct: 69 },
    { titleId: "ser_director", title: "The Director's Daughter", revenueUsd: 120_000, costUsd: 168_000, marginPct: -40 },
  ],
};

// Section 16: system health. The five known platform services, QoE against targets, recent error rates, a
// produce-pipeline job-failure list, and active alerts. Operational telemetry only; no PII, no reward
// weights. The status board mixes up / degraded / down so the chips are exercised.
export const DEMO_HEALTH: AdminHealth = {
  services: [
    { key: "content", name: "Content service", status: "up", latencyMs: 84, uptime: "99.98%", runbook: "RUNBOOK-content" },
    { key: "decision", name: "Decision service", status: "up", latencyMs: 112, uptime: "99.95%", runbook: "RUNBOOK-decision" },
    { key: "economy", name: "Economy / ledger service", status: "up", latencyMs: 73, uptime: "99.99%", runbook: "RUNBOOK-economy" },
    { key: "manifest", name: "Manifest service", status: "degraded", latencyMs: 318, uptime: "99.71%", runbook: "RUNBOOK-manifest" },
    { key: "settlement", name: "Settlement service", status: "up", latencyMs: 96, uptime: "99.97%", runbook: "RUNBOOK-settlement" },
  ],
  qoe: [
    { key: "startup", label: "Median startup time", value: "1.4s", target: "< 2.0s", withinTarget: true },
    { key: "rebuffer", label: "Rebuffer ratio", value: "0.6%", target: "< 1.0%", withinTarget: true },
    { key: "manifest_p95", label: "Manifest p95", value: "318ms", target: "< 250ms", withinTarget: false },
    { key: "decision_p95", label: "Decision p95", value: "112ms", target: "< 150ms", withinTarget: true },
  ],
  errorRates: [
    { service: "Content service", ratePct: 0.2, window: "last 1h" },
    { service: "Decision service", ratePct: 0.4, window: "last 1h" },
    { service: "Manifest service", ratePct: 2.1, window: "last 1h" },
    { service: "Settlement service", ratePct: 0.1, window: "last 1h" },
  ],
  jobFailures: [
    { id: "job_8841", stage: "render", title: "Shadow Signal S1E4 variant 12", reason: "GPU node preempted; auto-requeued", at: "2026-06-18 09:12", retries: 2 },
    { id: "job_8839", stage: "caption", title: "The Hidden Heiress S1E2", reason: "Caption vendor timeout", at: "2026-06-18 08:47", retries: 1 },
    { id: "job_8832", stage: "publish", title: "The Director's Daughter S1E1", reason: "Manifest service degraded; awaiting retry", at: "2026-06-18 08:05", retries: 0 },
  ],
  alerts: [
    { id: "al_1", severity: "warning", summary: "Manifest p95 above 250ms target for 18m", at: "2026-06-18 09:02", runbook: "RUNBOOK-manifest" },
    { id: "al_2", severity: "info", summary: "Storage + CDN egress nearing budget cap (94k / 85k)", at: "2026-06-18 07:30", runbook: "RUNBOOK-finops" },
  ],
};

// Section 17: settings & roles. The role-matrix VIEW is derived from the rbac policy capabilities; the
// integrations list, feature flags (one founder-gated, display-only), and the env-config KEY list (no secret
// values ever) round it out. The audit trail is a separate paged fetch (DEMO_SETTINGS_AUDIT below).
const ROLE_ORDER: OperatorRole[] = ["Owner", "Admin", "Content", "Finance", "Marketing", "Moderation", "Support", "ReadOnly"];

// Build a capability row from a per-role map, defaulting any unset role to "none".
function capRow(key: string, label: string, byRole: Partial<Record<OperatorRole, RoleCapability>>) {
  const full: Record<OperatorRole, RoleCapability> = {
    Owner: "none", Admin: "none", Content: "none", Finance: "none",
    Marketing: "none", Moderation: "none", Support: "none", ReadOnly: "none",
  };
  for (const r of ROLE_ORDER) if (byRole[r]) full[r] = byRole[r]!;
  return { key, label, byRole: full };
}

export const DEMO_SETTINGS: AdminSettings = {
  roles: ROLE_ORDER,
  capabilities: [
    capRow("content", "Content CMS", { Owner: "full", Admin: "full", Content: "full", Finance: "read", Marketing: "read", Moderation: "read", Support: "read", ReadOnly: "read" }),
    capRow("storygraph", "Adaptive story graph", { Owner: "full", Admin: "full", Content: "full", Finance: "read", Marketing: "read", Moderation: "read", Support: "read", ReadOnly: "read" }),
    capRow("media", "Media factory", { Owner: "manage", Admin: "manage", Content: "manage", Finance: "read", Marketing: "read", Moderation: "read", Support: "read", ReadOnly: "read" }),
    capRow("accessibility", "Accessibility factory", { Owner: "manage", Admin: "manage", Content: "manage", Moderation: "manage", Finance: "read", Marketing: "read", Support: "read", ReadOnly: "read" }),
    capRow("brands", "Brand integration", { Owner: "read", Admin: "read", Marketing: "read", ReadOnly: "read" }),
    capRow("users", "Users", { Owner: "manage", Admin: "manage", Support: "read", ReadOnly: "read" }),
    capRow("creators", "Creators", { Owner: "manage", Admin: "manage", Finance: "read", ReadOnly: "read" }),
    capRow("moderation", "Community & moderation", { Owner: "manage", Admin: "manage", Moderation: "manage", Content: "read", Finance: "read", Marketing: "read", Support: "read", ReadOnly: "read" }),
    capRow("monetization", "Monetization", { Owner: "read", Admin: "read", Content: "read", Finance: "read", Marketing: "read", Moderation: "read", Support: "read", ReadOnly: "read" }),
    capRow("analytics", "Analytics", { Owner: "read", Admin: "read", Content: "read", Finance: "read", Marketing: "read", Moderation: "read", Support: "read", ReadOnly: "read" }),
    capRow("growth", "Growth & UA", { Owner: "read", Admin: "read", Content: "read", Finance: "read", Marketing: "read", Moderation: "read", Support: "read", ReadOnly: "read" }),
    capRow("finance", "Finance & payouts", { Owner: "manage", Admin: "manage", Finance: "manage", ReadOnly: "read" }),
    capRow("trust", "Rights, consent, provenance", { Owner: "manage", Admin: "manage", Moderation: "read", ReadOnly: "read" }),
    capRow("health", "System health", { Owner: "read", Admin: "read", Support: "read", ReadOnly: "read" }),
    capRow("settings", "Settings & roles", { Owner: "manage", Admin: "manage" }),
    capRow("audit", "Admin audit trail (read)", { Owner: "read", Admin: "read", Content: "read", Finance: "read", Marketing: "read", Moderation: "read", Support: "read", ReadOnly: "read" }),
    capRow("reward_weights", "Reward-function weights", { Owner: "read", Admin: "read", Content: "read", Finance: "read", Marketing: "read", Moderation: "read", Support: "read", ReadOnly: "read" }),
  ],
  integrations: [
    { key: "stripe", name: "Stripe", description: "Payments and payouts. TEST mode until the live-rail cutover decision.", status: "test_mode" },
    { key: "supabase", name: "Supabase", description: "Hosted Postgres + auth for the sovereign data plane.", status: "connected" },
    { key: "captions", name: "Caption vendor", description: "Automated closed-caption generation in the accessibility factory.", status: "connected" },
    { key: "dub", name: "Dub / localization vendor", description: "Multi-language dubbing pipeline.", status: "connected" },
    { key: "sign", name: "Sign-language partner", description: "Human signer review and clip delivery.", status: "test_mode" },
    { key: "c2pa", name: "C2PA provenance", description: "Content credentials signing and public verification.", status: "degraded" },
    { key: "email", name: "Transactional email", description: "Operator and creator notifications.", status: "not_configured" },
  ],
  featureFlags: [
    { key: "social", label: "Viewer social (comments, feeds)", description: "Gates the moderation surface and community spaces.", enabled: false },
    { key: "alt_endings", label: "Alternate-ending purchases", description: "Lets viewers unlock alternate endings with credits.", enabled: true },
    { key: "pov_switch", label: "POV switching", description: "Lets viewers switch character POV mid-episode.", enabled: true },
    { key: "live_stripe", label: "Stripe live rail", description: "Switches Stripe from TEST to LIVE. Hard cutover gate, kept off.", enabled: false },
    { key: "reward_weights", label: "Reward-weight tuning", description: "Tuning the reward function is a founder sign-off, never an operator/agent action.", enabled: false, founderGated: true },
  ],
  envKeys: [
    { key: "VITE_ADMIN_API_BASE_URL", description: "Base URL the console points the admin API client at.", secret: false },
    { key: "VITE_ADMIN_OPERATOR_TOKEN", description: "Operator bearer (MFA-backed session token in production).", secret: true },
    { key: "SUPABASE_SERVICE_ROLE_KEY", description: "Server-side Supabase key used by the services, never the browser.", secret: true },
    { key: "STRIPE_SECRET_KEY", description: "Stripe secret key (TEST). Used only by the settlement service.", secret: true },
    { key: "C2PA_SIGNING_KEY", description: "Signing key for content-credentials provenance.", secret: true },
  ],
};

// The immutable admin audit trail demo page. tableApplied is true here so the UI shows a populated paged
// list; the live service returns tableApplied=false (empty) until the audit table is applied, and the page
// then renders the honest "audit table not yet applied" note instead.
export const DEMO_SETTINGS_AUDIT: AuditPage = {
  tableApplied: true,
  entries: [
    { id: "aud_1042", at: "2026-06-18 09:14", actor: "op_avery", role: "Owner", action: "settings.view", target: "Settings & roles", outcome: "executed" },
    { id: "aud_1041", at: "2026-06-18 09:02", actor: "op_lin", role: "Finance", action: "finance.payout", target: "run_2026_06", outcome: "seam_501" },
    { id: "aud_1040", at: "2026-06-18 08:51", actor: "op_kai", role: "Moderation", action: "moderation.act", target: "report rep_8812", outcome: "executed" },
    { id: "aud_1039", at: "2026-06-18 08:40", actor: "op_sam", role: "Support", action: "users.manage", target: "GDPR export usr_44102", outcome: "seam_501" },
    { id: "aud_1038", at: "2026-06-18 08:22", actor: "op_rosa", role: "Content", action: "content.publish", target: "Shadow Signal S1E4", outcome: "executed" },
    { id: "aud_1037", at: "2026-06-18 08:05", actor: "op_dev", role: "ReadOnly", action: "settings.manage", target: "feature flag: social", outcome: "denied" },
  ],
  nextCursor: null,
};
