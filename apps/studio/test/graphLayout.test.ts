// graphLayout places one node per beat in topological columns and classifies edges as fork (out of a
// branch point), premium (into a premium-bearing beat), or neutral. No em dashes.
import { describe, it, expect } from "vitest";
import { flattenGraph } from "../src/api/flattenGraph.js";
import { layoutGraph } from "../src/api/graphLayout.js";
import type { SeriesGraph } from "../src/api/contractGap.js";

function mkGraph(): SeriesGraph {
  return {
    series: {
      id: "11111111-1111-1111-1111-111111111111",
      title: "S",
      genre: null,
      base_language: "en",
      available_languages: ["en"],
      cover_url: null,
    },
    episodes: [
      {
        id: "22222222-2222-2222-2222-222222222222",
        episode_number: 1,
        title: null,
        is_free: true,
        coin_cost: 0,
        beats: [
          mkBeat("b1", 0, "cold_open", false, []),
          mkBeat("b2", 1, "spine", true, [v("v2", 3, false, 0)]),
          mkBeat("b3", 2, "variant", false, [v("v3", 2, false, 0)]),
          mkBeat("b4", 3, "ending", false, [v("v4", 3, false, 0), v("v5", 4, true, 5)]),
        ],
      },
    ],
    edges: [
      edge("b1", "b2"),
      edge("b2", "b3"),
      edge("b3", "b4"),
    ],
  };
}

function mkBeat(
  id: string,
  idx: number,
  role: SeriesGraph["episodes"][0]["beats"][0]["role"],
  branch: boolean,
  variants: SeriesGraph["episodes"][0]["beats"][0]["variants"],
): SeriesGraph["episodes"][0]["beats"][0] {
  return {
    id,
    episode_id: "22222222-2222-2222-2222-222222222222",
    beat_index: idx,
    role,
    is_branch_point: branch,
    canon_facts: {},
    variants,
  };
}

function v(
  id: string,
  intensity: number,
  premium: boolean,
  coin: number,
): SeriesGraph["episodes"][0]["beats"][0]["variants"][0] {
  return {
    id,
    language: "en",
    accessibility: {},
    intensity,
    pov: null,
    tier: "A_filmed",
    is_premium: premium,
    coin_cost: coin,
    playback_url: "https://x",
    duration_ms: null,
    qa_status: "passed",
  };
}

function edge(from: string, to: string) {
  return { from_beat_id: from, to_beat_id: to, condition: {} };
}

describe("layoutGraph", () => {
  it("places one node per beat in increasing columns by depth", () => {
    const layout = layoutGraph(flattenGraph(mkGraph()));
    expect(layout.nodes).toHaveLength(4);
    const x = (id: string) => layout.nodes.find((n) => n.beat.id === id)!.x;
    expect(x("b1")).toBeLessThan(x("b2"));
    expect(x("b2")).toBeLessThan(x("b3"));
    expect(x("b3")).toBeLessThan(x("b4"));
  });

  it("marks a premium-bearing beat as a premium node with its coin cost", () => {
    const layout = layoutGraph(flattenGraph(mkGraph()));
    const ending = layout.nodes.find((n) => n.beat.id === "b4")!;
    expect(ending.isPremium).toBe(true);
    expect(ending.premiumCoinCost).toBe(5);
  });

  it("classifies the edge out of the branch point as a fork", () => {
    const layout = layoutGraph(flattenGraph(mkGraph()));
    const forks = layout.edges.filter((e) => e.kind === "fork");
    // b2 is the branch point, so b2 -> b3 is a fork.
    expect(forks.some((e) => e.from === "b2")).toBe(true);
    // Every edge has a non-empty path.
    expect(layout.edges.every((e) => e.path.startsWith("M"))).toBe(true);
  });
});
