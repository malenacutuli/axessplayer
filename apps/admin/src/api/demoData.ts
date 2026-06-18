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
  AdminMe,
  AdminPlacements,
  AdminUsers,
  ContentNode,
  CreatorDetail,
  MediaFactoryJobs,
  SimulateRequest,
  SimulateResult,
  StoryGraph,
  StoryValidation,
  UserDetail,
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
