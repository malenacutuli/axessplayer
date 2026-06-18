// Unit tests for the pure catalog-graph helpers: broken-link detection, the publish-readiness verdict
// (canon + links block; orphans warn), the Simple-mode linear timeline, and the Pro-mode column layout.
// No em dashes.
import { describe, it, expect } from "vitest";
import {
  brokenLinks,
  layoutColumns,
  linearTimeline,
  orphanNodes,
  publishReadiness,
} from "../src/api/catalogGraph.js";
import type { SeriesGraphView } from "../src/api/catalogTypes.js";

function view(partial: Partial<SeriesGraphView>): SeriesGraphView {
  return {
    seriesId: "s1",
    seriesTitle: "Test",
    nodes: [],
    edges: [],
    memoryVars: [],
    canon: { valid: true, issues: [] },
    ...partial,
  };
}

const linear = view({
  nodes: [
    { id: "a", kind: "beat", title: "Cold open" },
    { id: "b", kind: "branch", title: "The fork" },
    { id: "c", kind: "ending", title: "Reunion" },
    { id: "p", kind: "premium", title: "Alt ending", pricing: { priceCoins: 5, source: "uploaded" } },
  ],
  edges: [
    { from: "a", to: "b", isDefault: true },
    { from: "b", to: "c", isDefault: true },
    { from: "b", to: "p", choice: "pay" },
  ],
});

describe("catalogGraph helpers", () => {
  it("detects broken links pointing at a missing node", () => {
    const v = view({
      nodes: [{ id: "a", kind: "beat", title: "A" }],
      edges: [{ from: "a", to: "ghost" }],
    });
    const broken = brokenLinks(v);
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ from: "a", to: "ghost", missing: "to" });
  });

  it("blocks publishing on a broken link", () => {
    const v = view({
      nodes: [{ id: "a", kind: "beat", title: "A" }],
      edges: [{ from: "a", to: "ghost" }],
    });
    const r = publishReadiness(v);
    expect(r.publishable).toBe(false);
    expect(r.blockers.some((b) => /broken link/i.test(b))).toBe(true);
  });

  it("blocks publishing on a canon error and warns on a canon warning", () => {
    const v = view({
      nodes: [{ id: "a", kind: "beat", title: "A" }],
      canon: {
        valid: false,
        issues: [
          { severity: "error", message: "Mara is dead but appears in beat 4" },
          { severity: "warning", message: "POV switch is abrupt" },
        ],
      },
    });
    const r = publishReadiness(v);
    expect(r.publishable).toBe(false);
    expect(r.blockers.some((b) => /Mara is dead/.test(b))).toBe(true);
    expect(r.warnings.some((w) => /POV switch/.test(w))).toBe(true);
  });

  it("treats an unconnected node as a soft warning, not a blocker", () => {
    const v = view({
      nodes: [
        { id: "a", kind: "beat", title: "A" },
        { id: "x", kind: "beat", title: "Orphan" },
      ],
      edges: [],
    });
    expect(orphanNodes(v).map((n) => n.id)).toContain("x");
    const r = publishReadiness(v);
    // The orphan is the only issue, so the graph is still publishable.
    expect(r.publishable).toBe(true);
    expect(r.warnings.some((w) => /Orphan/.test(w))).toBe(true);
  });

  it("derives a linear timeline along the default path with offshoots", () => {
    const steps = linearTimeline(linear);
    expect(steps.map((s) => s.node.id)).toEqual(["a", "b", "c"]);
    // The premium alt ending is an offshoot of the branch step, not on the spine.
    const branchStep = steps.find((s) => s.node.id === "b");
    expect(branchStep?.offshoots.map((o) => o.id)).toEqual(["p"]);
  });

  it("lays out columns by depth from the entry node", () => {
    const { nodes, maxCol } = layoutColumns(linear);
    const col = new Map(nodes.map((n) => [n.id, n.col]));
    expect(col.get("a")).toBe(0);
    expect(col.get("b")).toBe(1);
    expect(col.get("c")).toBe(2);
    expect(maxCol).toBeGreaterThanOrEqual(2);
  });
});
